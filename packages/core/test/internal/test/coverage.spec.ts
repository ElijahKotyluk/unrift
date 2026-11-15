import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Coverage runs write reports, so each test gets its own scratch dir (gitignored)
const WORK = resolve(process.cwd(), "test/coverage/.work");

function workspace(name: string, files: Record<string, string>) {
  const dir = join(WORK, name);

  rmSync(dir, { recursive: true, force: true });

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }

  if (!files["unrift.config.ts"]) {
    writeFileSync(
      join(dir, "unrift.config.ts"),
      `export default { testDir: "test" };\n`,
    );
  }

  return {
    dir,
    run(...args: string[]) {
      const res = spawnSync(
        process.execPath,
        [
          resolve(process.cwd(), "bin/unrift.mjs"),
          "--config",
          join(dir, "unrift.config.ts"),
          "--json",
          ...args,
        ],
        { encoding: "utf8" },
      );

      return { status: res.status, report: JSON.parse(res.stdout) };
    },
  };
}

type FileSummary = {
  file: string;
  lines: { covered: number; total: number };
  functions: { covered: number; total: number };
  branches: { covered: number; total: number };
  uncoveredLines: number[];
};

function fileIn(report: { coverage: { files: FileSummary[] } }, end: string) {
  return report.coverage.files.find((f) => f.file.endsWith(end));
}

const MATH = `// helpers
export interface Opts { round: boolean }

export function add(a: number, b: number): number {
  return a + b;
}

export function sign(n: number): string {
  if (n > 0) {
    return "pos";
  } else {
    return "neg";
  }
}

export function unused(x: number) {
  const y = x * 2;
  return y;
}
`;

describe("coverage", () => {
  it("maps bundled TypeScript and plain JS back to their lines", () => {
    const ws = workspace("lines", {
      "src/math.ts": MATH,
      "src/plain.js": `export function hello(name) {
  if (!name) {
    return "nobody";
  }
  return "hi " + name;
}
`,
      "test/a.spec.ts": `import { it, expect } from "@unrift/core";
import { add, sign } from "../src/math";
it("adds", () => {
  expect(add(1, 2)).toBe(3);
  expect(sign(1)).toBe("pos");
});
`,
      "test/b.spec.js": `import { it, expect } from "@unrift/core";
import { hello } from "../src/plain.js";
it("hello", () => expect(hello("x")).toBe("hi x"));
`,
    });

    const { status, report } = ws.run("--coverage");

    expect(status).toBe(0);
    // Test files aren't reported, only the code they ran
    expect(report.coverage.files.map((f: FileSummary) => f.file)).toEqual([
      `${ws.dir}/src/math.ts`,
      `${ws.dir}/src/plain.js`,
    ]);

    const math = fileIn(report, "src/math.ts")!;

    // `unused` isn't imported, it's still there: tree shaking would drop it.
    // Comments, blank lines and the interface aren't code.
    expect(math.uncoveredLines).toEqual([12, 13, 16, 17, 18, 19]);
    expect(math.lines).toMatchObject({ covered: 8, total: 14 });
    expect(math.functions).toMatchObject({ covered: 2, total: 3 });
    expect(math.branches).toMatchObject({ covered: 0, total: 1 });

    const plain = fileIn(report, "src/plain.js")!;

    expect(plain.uncoveredLines).toEqual([3, 4]);
    expect(plain.functions).toMatchObject({ covered: 1, total: 1 });
  });

  it("adds up a file bundled into two test files", () => {
    // Each test takes one side of the if. V8 leaves out the side that ran as
    // often as the function, so each bundle alone only knows one branch.
    const ws = workspace("merge", {
      "src/math.ts": MATH,
      "test/pos.spec.ts": `import { it, expect } from "@unrift/core";
import { sign } from "../src/math";
it("pos", () => expect(sign(1)).toBe("pos"));
`,
      "test/neg.spec.ts": `import { it, expect } from "@unrift/core";
import { add, sign } from "../src/math";
it("neg", () => {
  expect(sign(-1)).toBe("neg");
  expect(add(1, 1)).toBe(2);
});
`,
    });

    const math = fileIn(ws.run("--coverage").report, "src/math.ts")!;

    expect(math.uncoveredLines).toEqual([16, 17, 18, 19]);
    expect(math.functions).toMatchObject({ covered: 2, total: 3 });
    expect(math.branches).toMatchObject({ covered: 2, total: 2 });
  });

  it("filters files, writes lcov and json, and fails under a threshold", () => {
    const ws = workspace("reports", {
      "unrift.config.ts": `export default {
  testDir: "test",
  coverage: {
    enabled: true,
    exclude: ["src/skip/**"],
    reporter: ["lcov", "json"],
    reportsDirectory: "out",
    thresholds: { lines: 60, functions: 100 },
  },
};
`,
      "src/math.ts": MATH,
      "src/skip/other.ts": `export const other = () => 1;\n`,
      "test/a.spec.ts": `import { it, expect } from "@unrift/core";
import { add, sign } from "../src/math";
import { other } from "../src/skip/other";
it("adds", () => {
  expect(add(1, 2) + other()).toBe(4);
  expect(sign(1)).toBe("pos");
});
`,
    });

    const { status, report } = ws.run();

    expect(status).toBe(1);
    // Lines are at 57.14%, functions at 66.66%
    expect(report.coverage.failures).toEqual([
      "Coverage for lines (57.14%) is below the 60% threshold",
      "Coverage for functions (66.66%) is below the 100% threshold",
    ]);
    expect(report.coverage.files).toHaveLength(1);

    const lcov = readFileSync(join(ws.dir, "out/lcov.info"), "utf8");

    expect(lcov).toContain(`SF:${join(ws.dir, "src/math.ts")}`);
    expect(lcov).toContain("FNDA:0,unused");
    expect(lcov).toContain("DA:12,0");
    expect(lcov).not.toContain("other.ts");

    const json = JSON.parse(
      readFileSync(join(ws.dir, "out/coverage-summary.json"), "utf8"),
    );

    expect(json.total.lines).toEqual({
      covered: 8,
      total: 14,
      pct: 57.14,
      skipped: 0,
    });

    // Same files, thresholds met: passes
    writeFileSync(
      join(ws.dir, "unrift.config.ts"),
      `export default { testDir: "test", coverage: { enabled: true, reporter: "text", thresholds: { lines: 50 } } };\n`,
    );
    rmSync(join(ws.dir, "out"), { recursive: true });

    expect(ws.run().status).toBe(0);
    expect(existsSync(join(ws.dir, "out"))).toBe(false);
  });

  it("a second run sees edits to imported files and counts from zero", () => {
    const ws = workspace("rerun", {
      "src/value.ts": `export const value = () => 1;\n`,
      "test/a.spec.ts": `import { it } from "@unrift/core";
import { value } from "../src/value";
it("reads", () => {
  (globalThis as any).__seen.push(value());
});
`,
    });
    const script = join(ws.dir, "run.mjs");

    // Two runs in one process, like watch mode. The edit is to the imported
    // file only, the test file stays the same.
    writeFileSync(
      script,
      `import { runEngine } from ${JSON.stringify(pathToFileURL(resolve(process.cwd(), "dist/esm/index.js")).href)};
import { writeFileSync } from "node:fs";
globalThis.__seen = [];
const opts = { files: [${JSON.stringify(join(ws.dir, "test/a.spec.ts"))}], coverage: { root: ${JSON.stringify(ws.dir)} } };
const first = await runEngine(opts);
writeFileSync(${JSON.stringify(join(ws.dir, "src/value.ts"))}, "// moved down\\nexport const value = () => 2;\\n");
const second = await runEngine(opts);
console.log(JSON.stringify({ seen: globalThis.__seen, lines: [first, second].map((r) => r.coverage.files[0].lines) }));
`,
    );

    const res = spawnSync(process.execPath, [script], { encoding: "utf8" });

    expect(JSON.parse(res.stdout)).toEqual({
      seen: [1, 2],
      lines: [{ 1: 1 }, { 2: 1 }],
    });
  });
});
