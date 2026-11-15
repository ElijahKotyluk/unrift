import { describe, it, expect } from "@unrift/core";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { serialize } from "../../../src/snapshot/serialize.js";

// Snapshot runs write files, so each test gets its own scratch dir (gitignored).
const WORK = resolve(process.cwd(), "test/snapshots/.work");

function workspace(name: string) {
  const dir = join(WORK, name);

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "unrift.config.ts"),
    `export default { testDir: "." };\n`,
  );

  const snapPath = join(dir, "__snapshots__", "a.spec.ts.snap");
  const specPath = join(dir, "a.spec.ts");

  return {
    snapPath,
    dir,
    specPath,
    source: () => readFileSync(specPath, "utf8"),
    setSource: (text: string) => writeFileSync(specPath, text),
    spec(body: string) {
      writeFileSync(
        specPath,
        `import { describe, it, expect, beforeAll } from "@unrift/core";\n${body}`,
      );
    },
    snap: () => readFileSync(snapPath, "utf8"),
    run(env: Record<string, string> = {}, ...args: string[]) {
      const stdout = cli(dir, env, "--json", ...args);

      return { status: stdout.status, report: JSON.parse(stdout.output) };
    },
    /** The terminal output, for what a person reads. */
    text: () => cli(dir, {}).output,
  };
}

function cli(dir: string, env: Record<string, string>, ...args: string[]) {
  const res = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      join(dir, "unrift.config.ts"),
      ...args,
    ],
    // CI is set on GitHub Actions and would stop new snapshots being written
    { encoding: "utf8", env: { ...process.env, CI: "", ...env } },
  );

  return { status: res.status, output: res.stdout };
}

describe("snapshots", () => {
  it("writes new snapshots, matches them, and -u updates them", () => {
    const ws = workspace("basic");
    const spec = (n: number) =>
      ws.spec(`
describe("user", () => {
  it("serializes", () => {
    expect({ name: "a \`tick\` \${x} \\\\", tags: ["x"] }).toMatchSnapshot();
    expect("two\\nlines").toMatchSnapshot("text");
    expect("a\\r\\nb").toMatchSnapshot("crlf");
    expect(${n}).toMatchSnapshot();
  });
});
`);

    spec(42);
    const first = ws.run();

    expect(first.status).toBe(0);
    expect(first.report.snapshots).toMatchObject({ added: 4, failed: 0 });
    // Escaped so it round-trips through the template literal
    expect(ws.snap()).toBe(
      [
        "// Unrift Snapshot v1",
        "",
        "exports[`user serializes 1`] = `",
        "{",
        '  "name": "a \\`tick\\` \\${x} \\\\\\\\",',
        '  "tags": [',
        '    "x",',
        "  ],",
        "}",
        "`;",
        "",
        "exports[`user serializes 2`] = `42`;",
        "",
        "exports[`user serializes: crlf 1`] = `",
        '"a\\r',
        'b"',
        "`;",
        "",
        "exports[`user serializes: text 1`] = `",
        '"two',
        'lines"',
        "`;",
        "",
      ].join("\n"),
    );

    const written = ws.snap();
    const second = ws.run();

    expect(second.status).toBe(0);
    expect(second.report.snapshots).toMatchObject({ added: 0, updated: 0 });
    expect(ws.snap()).toBe(written);

    spec(43);
    const changed = ws.run();

    expect(changed.status).toBe(1);
    expect(changed.report.results[0].error.message).toContain(
      "Snapshot `user serializes 2` doesn't match",
    );
    expect(changed.report.results[0].error.message).toContain("- 43\n+ 42");
    expect(ws.snap()).toBe(written);

    const updated = ws.run({}, "-u");

    expect(updated.status).toBe(0);
    expect(updated.report.snapshots.updated).toBe(1);
    expect(ws.snap()).toContain("exports[`user serializes 2`] = `43`;");
  });

  it("obsolete snapshots fail the run, -u removes them, skipped tests keep theirs", () => {
    const ws = workspace("obsolete");

    ws.spec(`
it("a", () => expect(1).toMatchSnapshot());
it("b", () => expect(2).toMatchSnapshot());
it("c", () => expect(3).toMatchSnapshot());
`);
    ws.run();

    ws.spec(`
it("a", () => expect(1).toMatchSnapshot());
it.skip("b", () => expect(2).toMatchSnapshot());
`);
    const stale = ws.run();

    // Only c is obsolete. b didn't run, that doesn't make it stale.
    expect(stale.status).toBe(1);
    expect(stale.report.ok).toBe(false);
    expect(stale.report.snapshots).toMatchObject({ obsolete: 1, removed: 0 });
    // Says which one, so a rename can be told from a snapshot that only runs sometimes
    expect(stale.report.snapshots.obsoleteKeys).toEqual([
      { file: ws.snapPath.replace(/\\/g, "/"), key: "c 1" },
    ]);
    expect(ws.text()).toContain("a.spec.ts.snap\n     › c 1");

    const cleaned = ws.run({}, "-u");

    expect(cleaned.status).toBe(0);
    expect(cleaned.report.snapshots).toMatchObject({ obsolete: 1, removed: 1 });
    expect(cleaned.report.snapshots.obsoleteKeys).toEqual([]);
    expect(ws.snap()).toContain("exports[`b 1`]");
    expect(ws.snap()).not.toContain("exports[`c 1`]");

    // A test that failed before its snapshot keeps it too, hinted ones included
    ws.spec(`
it.skip("b", () => {});
it("d", () => expect(4).toMatchSnapshot("hinted"));
`);
    ws.run();
    ws.spec(`
it.skip("b", () => {});
it("d", () => { throw new Error("broken"); });
`);
    ws.run({}, "-u");

    expect(ws.snap()).toContain("exports[`d: hinted 1`]");

    // A file that fails to import never ran, -u mustn't wipe its snapshots.
    // A test registered before the error doesn't run either, so it can't
    // write an inline snapshot into the broken file.
    const kept = ws.snap();
    ws.spec(
      `it("early", () => expect(1).toMatchInlineSnapshot());\nthrow new Error("broken");\n`,
    );
    const brokenSource = ws.source();
    const broken = ws.run({}, "-u");

    expect(ws.snap()).toBe(kept);
    expect(ws.source()).toBe(brokenSource);
    expect(
      broken.report.results.find((r: { description: string }) =>
        r.description.endsWith("early"),
      ).status,
    ).toBe("skipped");

    // Nothing left: the file and the folder go
    ws.spec(`it("a", () => {});\n`);
    ws.run({}, "-u");

    expect(existsSync(ws.snapPath)).toBe(false);
    expect(existsSync(join(ws.snapPath, ".."))).toBe(false);
  });

  it("doesn't write new snapshots on CI", () => {
    const ws = workspace("ci");

    ws.spec(`it("a", () => expect(1).toMatchSnapshot());\n`);
    const res = ws.run({ CI: "true" });

    expect(res.status).toBe(1);
    expect(res.report.results[0].error.message).toContain(
      "New snapshot `a 1` was not written",
    );
    expect(existsSync(ws.snapPath)).toBe(false);

    expect(ws.run({ CI: "0" }).status).toBe(0);
    expect(existsSync(ws.snapPath)).toBe(true);
  });

  it("counts snapshots per test across retries, duplicate names and timeouts", () => {
    const ws = workspace("counting");

    ws.spec(`
let runs = 0;
it("flaky", () => {
  expect("attempt " + ++runs).toMatchSnapshot();
  if (runs === 1) throw new Error("first attempt");
}, { retries: 1 });

it("same", () => expect("first").toMatchSnapshot());
it("same", () => expect("second").toMatchSnapshot());

it("slow", async () => {
  await new Promise((r) => setTimeout(r, 60));
  expect("late").toMatchSnapshot();
}, 20);

it("next", async () => {
  await new Promise((r) => setTimeout(r, 100));
  expect("next").toMatchSnapshot();
});
`);
    const { report } = ws.run();
    const snap = ws.snap();

    // The retry is checked on its own, the failed attempt's snapshot isn't saved,
    // and it doesn't make it "flaky 2"
    expect(report.results[0].status).toBe("pass");
    expect(snap).toContain('exports[`flaky 1`] = `"attempt 2"`;');
    expect(snap).not.toContain("flaky 2");
    expect(snap).toContain('exports[`same 1`] = `"first"`;');
    expect(snap).toContain('exports[`same 2`] = `"second"`;');
    // The timed-out body snapshots while "next" runs, it must not land there
    expect(snap).toContain('exports[`next 1`] = `"next"`;');
    expect(snap).not.toContain("late");
  });

  it("rejects .not, non-string hints and calls outside a test", () => {
    const ws = workspace("misuse");

    ws.spec(`
describe("hooks", () => {
  beforeAll(() => expect(1).toMatchSnapshot());
  it("x", () => {});
});
it("not", () => expect(1).not.toMatchSnapshot());
it("hint", () => expect(1).toMatchSnapshot({ id: 1 } as any));

// Registered in beforeAll, runs during the test: that test owns it
describe("callback", () => {
  let fire: (v: string) => void;
  let done: Promise<void>;
  beforeAll(() => {
    done = new Promise<string>((r) => (fire = r)).then((v) =>
      expect(v).toMatchSnapshot(),
    );
  });
  it("from beforeAll", async () => {
    fire("x");
    await done;
  });
});
`);
    const { report } = ws.run();
    const error = (name: string) =>
      report.results.find((r: { description: string }) =>
        r.description.endsWith(name),
      ).error.message;

    expect(error("[beforeAll]")).toContain("can only be called inside a test");
    expect(error("not")).toContain("can't be used with .not");
    expect(error("hint")).toContain("hint must be a string");
    // Only the callback's snapshot was written
    expect(ws.snap()).toBe(
      '// Unrift Snapshot v1\n\nexports[`callback from beforeAll 1`] = `"x"`;\n',
    );
  });

  it("writes inline snapshots into the test file, matches them, and -u updates them", () => {
    // Non-ASCII and # in the path, source maps URL-encode those
    const ws = workspace("inline café#1");

    // The interface shifts lines in the bundle, so this goes through the source
    // map. U+2028 and a lone \\r are line breaks to the source map too.
    ws.spec(`
interface Unused {
  a: number;
}
const sep = "a\u2028b"; /* old mac\r comment */

describe("inline", () => {
  it("writes", () => {
    expect({ a: 1 }).toMatchInlineSnapshot();
    expect(1).toMatchInlineSnapshot(); expect("one").toMatchInlineSnapshot();
    expect(42)
      .toMatchInlineSnapshot();
  });
});
`);
    const first = ws.run();
    const written = ws.source();

    expect(first.status).toBe(0);
    expect(first.report.snapshots).toMatchObject({ added: 4 });
    expect(written).toContain(
      [
        "    expect({ a: 1 }).toMatchInlineSnapshot(`",
        "      {",
        '        "a": 1,',
        "      }",
        "    `);",
        '    expect(1).toMatchInlineSnapshot(`1`); expect("one").toMatchInlineSnapshot(`"one"`);',
        "    expect(42)",
        "      .toMatchInlineSnapshot(`42`);",
      ].join("\n"),
    );

    expect(ws.run().status).toBe(0);
    expect(ws.source()).toBe(written);

    ws.setSource(ws.source().replace("expect(42)", "expect(43)"));
    const changed = ws.source();
    const failed = ws.run();

    expect(failed.status).toBe(1);
    expect(failed.report.results[0].error.message).toContain("- 43\n+ 42");
    expect(ws.source()).toBe(changed);

    expect(ws.run({}, "-u").report.snapshots.updated).toBe(1);
    expect(ws.source()).toContain(".toMatchInlineSnapshot(`43`);");

    // Nothing written on CI
    ws.spec(`it("a", () => expect(1).toMatchInlineSnapshot());\n`);
    const ci = ws.source();

    expect(ws.run({ CI: "true" }).report.results[0].error.message).toContain(
      "New inline snapshot was not written",
    );
    expect(ws.source()).toBe(ci);

    // A CRLF file stays CRLF and still matches on the next run
    ws.setSource(
      `import { it, expect } from "@unrift/core";\r\nit("a", () => {\r\n  expect({ a: 1 }).toMatchInlineSnapshot();\r\n});\r\n`,
    );
    ws.run();

    expect(ws.source().replace(/\r\n/g, "")).not.toContain("\n");
    expect(ws.source()).toContain('\r\n      "a": 1,\r\n');
    expect(ws.run().status).toBe(0);

    // Edited during the run, before the snapshot. The offsets are stale so
    // it's left alone.
    ws.spec(`import { readFileSync, writeFileSync } from "node:fs";
it("a", () => {
  const path = ${JSON.stringify(ws.specPath)};
  writeFileSync(path, "// edited\\n" + readFileSync(path, "utf8"));
  expect(0).toMatchInlineSnapshot(\`0\`);
  expect(1).toMatchInlineSnapshot();
});
`);
    // Same for a plain .js file, which isn't bundled so has no copy of what ran
    const jsPath = join(ws.dir, "b.spec.mjs");
    writeFileSync(
      jsPath,
      `import { it, expect } from "@unrift/core";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
it("js", () => {
  const path = fileURLToPath(import.meta.url);
  writeFileSync(path, "// edited\\n" + readFileSync(path, "utf8"));
  expect(0).toMatchInlineSnapshot(\`0\`);
  expect(1).toMatchInlineSnapshot();
});
`,
    );
    // An untouched one is still written
    const plainPath = join(ws.dir, "c.spec.mjs");
    writeFileSync(
      plainPath,
      `import { it, expect } from "@unrift/core";\nit("plain", () => expect(1).toMatchInlineSnapshot());\n`,
    );
    const edited = ws.run();

    expect(edited.report.snapshots.inlineSkipped).toHaveLength(2);
    expect(readFileSync(plainPath, "utf8")).toContain(
      "toMatchInlineSnapshot(`1`)",
    );
    expect(readFileSync(jsPath, "utf8")).toContain(
      "expect(0).toMatchInlineSnapshot(`0`);\n  expect(1).toMatchInlineSnapshot();",
    );
    expect(ws.source()).toContain(
      "expect(0).toMatchInlineSnapshot(`0`);\n  expect(1).toMatchInlineSnapshot();",
    );
  });

  it("only writes inline snapshots it can place", () => {
    const ws = workspace("inline-misuse");

    ws.spec(`
const missing: string | undefined = undefined;
let runs = 0;

it("loop", () => {
  for (const n of [1, 2]) expect(n).toMatchInlineSnapshot();
});
it("flaky", () => {
  expect("attempt " + ++runs).toMatchInlineSnapshot();
  if (runs === 1) throw new Error("first attempt");
}, { retries: 1 });
it("not", () => expect(1).not.toMatchInlineSnapshot());
it("number", () => expect(1).toMatchInlineSnapshot(1 as any));
it("variable", () => expect(1).toMatchInlineSnapshot(missing));
it("resolves", () => expect(Promise.resolve(1)).resolves.toMatchInlineSnapshot());
it("resolves match", () => expect(Promise.resolve(1)).resolves.toMatchInlineSnapshot("1"));

// Two tests, one spot, different values
const shared = (n: number) => expect(n).toMatchInlineSnapshot();
it("shared a", () => shared(1));
it("shared b", () => shared(2));
`);
    const { report } = ws.run();
    const result = (name: string) =>
      report.results.find((r: { description: string }) =>
        r.description.endsWith(name),
      );

    expect(result("loop").error.message).toContain(
      "ran more than once with different values",
    );
    // Not even the first value
    expect(ws.source()).toContain(
      "for (const n of [1, 2]) expect(n).toMatchInlineSnapshot();",
    );
    expect(result("not").error.message).toContain("can't be used with .not");
    expect(result("number").error.message).toContain(
      "snapshot must be a string",
    );
    expect(result("variable").error.message).toContain(
      "needs no argument or a single string",
    );
    expect(result("resolves").error.message).toContain(
      "can't write a snapshot under .resolves",
    );
    expect(result("resolves match").status).toBe("pass");
    expect(result("shared b").error.message).toContain(
      "ran more than once with different values",
    );
    expect(ws.source()).toContain(
      "const shared = (n: number) => expect(n).toMatchInlineSnapshot();",
    );
    // loop, variable, resolves and shared b. .not and a number are misuse,
    // rejected before any snapshot is checked.
    expect(report.snapshots.failed).toBe(4);
    // The failed attempt's value isn't the one written
    expect(result("flaky").status).toBe("pass");
    expect(ws.source()).toContain('toMatchInlineSnapshot(`"attempt 2"`)');
    expect(ws.source()).toContain("toMatchInlineSnapshot(missing)");

    // -u sees the call that matched too, so it doesn't write 2 over it. A match
    // it can't rewrite is fine, an interpolated template is never replaced.
    ws.spec(`
const one = "1";
const two = 2;
it("u", () => {
  for (const n of [2, 1]) expect(n).toMatchInlineSnapshot(\`1\`);
});
it("variable match", () => expect(1).toMatchInlineSnapshot(one));
it("template", () => expect(1).toMatchInlineSnapshot(\`\${two}\`));
`);
    const u = ws.run({}, "-u");
    const uResult = (name: string) =>
      u.report.results.find((r: { description: string }) =>
        r.description.endsWith(name),
      );

    expect(uResult("u").status).toBe("fail");
    expect(uResult("variable match").status).toBe("pass");
    expect(uResult("template").error.message).toContain(
      "needs no argument or a single string",
    );
    expect(ws.source()).toContain("expect(n).toMatchInlineSnapshot(`1`);");
    expect(ws.source()).toContain("toMatchInlineSnapshot(`${two}`)");
  });

  it("fails the run when a snapshot file can't be read or written", () => {
    const ws = workspace("io-errors");
    const errors = (res: ReturnType<typeof ws.run>) =>
      res.report.snapshots.errors.map((e: { message: string }) => e.message);

    // A .snap no test uses anymore, left with merge conflict markers
    ws.spec(`it("a", () => {});\n`);
    mkdirSync(join(ws.snapPath, ".."));
    writeFileSync(ws.snapPath, "<<<<<<< HEAD\n");
    const broken = ws.run();

    expect(broken.status).toBe(1);
    expect(errors(broken)[0]).toContain("Couldn't read snapshot file");

    // Read once, then a retry passes without it: still reported
    ws.spec(`let n = 0;
it("a", () => {
  if (++n === 1) expect(1).toMatchSnapshot();
}, { retries: 1 });
`);
    const retried = ws.run();

    expect(retried.status).toBe(1);
    expect(errors(retried)[0]).toContain("Couldn't read snapshot file");

    // __snapshots__ is a file, so the .snap can't be written
    rmSync(join(ws.snapPath, ".."), { recursive: true });
    writeFileSync(join(ws.snapPath, ".."), "");
    ws.spec(`it("a", () => expect(1).toMatchSnapshot());\n`);
    const blocked = ws.run();

    expect(blocked.status).toBe(1);
    expect(blocked.report.snapshots.errors).toHaveLength(1);
    // Nothing was saved, so nothing counts as written
    expect(blocked.report.snapshots.added).toBe(0);
    rmSync(join(ws.snapPath, ".."));

    // A read-only test file can't take an inline snapshot. Root can write it anyway.
    if (process.getuid?.() !== 0) {
      ws.spec(`it("a", () => expect(1).toMatchInlineSnapshot());\n`);
      const source = ws.source();
      chmodSync(ws.specPath, 0o444);
      const readOnly = ws.run();
      chmodSync(ws.specPath, 0o644);

      expect(readOnly.status).toBe(1);
      expect(readOnly.report.snapshots.errors).toHaveLength(1);
      expect(ws.source()).toBe(source);

      // Unreadable by the end of the run is an error too, not a skip
      ws.spec(`import { chmodSync } from "node:fs";
it("a", () => {
  expect(1).toMatchInlineSnapshot();
  chmodSync(${JSON.stringify(ws.specPath)}, 0o000);
});
`);
      const unreadable = ws.run();
      chmodSync(ws.specPath, 0o644);

      expect(unreadable.status).toBe(1);
      expect(unreadable.report.snapshots.errors).toHaveLength(1);
      expect(unreadable.report.snapshots.inlineSkipped).toEqual([]);

      // A .snap -u can't rewrite keeps its obsolete snapshot in the report
      ws.spec(
        `it("a", () => expect(1).toMatchSnapshot());\nit("b", () => expect(2).toMatchSnapshot());\n`,
      );
      ws.run();
      ws.spec(`it("a", () => expect(1).toMatchSnapshot());\n`);
      chmodSync(ws.snapPath, 0o444);
      const stuck = ws.run({}, "-u");
      chmodSync(ws.snapPath, 0o644);

      expect(stuck.report.snapshots).toMatchObject({ removed: 0 });
      expect(stuck.report.snapshots.obsoleteKeys).toEqual([
        { file: ws.snapPath.replace(/\\/g, "/"), key: "b 1" },
      ]);
    }
  });

  it("runs every file again when runEngine is called again in the same process", () => {
    // Watch mode does this. A file that didn't change came back from Node's
    // module cache and registered no tests, so its snapshots looked obsolete.
    const ws = workspace("rerun");
    const fileSpec = join(ws.dir, "x.spec.ts");

    writeFileSync(
      fileSpec,
      `import { it, expect } from "@unrift/core";\nit("x", () => expect(1).toMatchSnapshot());\n`,
    );
    // CommonJS is cached by filename, not URL, so it needs its own handling
    const cjsSpec = join(ws.dir, "z.spec.cjs");

    writeFileSync(
      cjsSpec,
      `const { it, expect } = require("@unrift/core");\nit("z", () => expect(3).toMatchSnapshot());\n`,
    );
    ws.spec(`it("y", () => expect(2).toMatchInlineSnapshot());\n`);
    writeFileSync(
      join(ws.dir, "run.mjs"),
      `import { runEngine } from "@unrift/core";
const all = [${JSON.stringify(fileSpec)}, ${JSON.stringify(cjsSpec)}, ${JSON.stringify(ws.specPath)}];
const runs = [];
for (const [files, updateSnapshots] of [[all, "none"], [all, "new"], [all.slice(0, 2), "all"]]) {
  const res = await runEngine({ files, updateSnapshots });
  runs.push({ tests: res.results.length, snapshots: res.snapshots });
}
console.log(JSON.stringify(runs));
`,
    );
    const res = spawnSync(process.execPath, [join(ws.dir, "run.mjs")], {
      encoding: "utf8",
      env: { ...process.env, CI: "" },
    });
    const [, second, third] = JSON.parse(res.stdout);

    // Second run: nothing changed on disk since the first, every file still runs
    expect(second.tests).toBe(3);
    expect(second.snapshots.added).toBe(3);
    expect(ws.source()).toContain("toMatchInlineSnapshot(`2`)");
    // Third run with -u: x and z are unchanged and cached, their snapshots must survive
    expect(third.tests).toBe(2);
    expect(third.snapshots.removed).toBe(0);
    expect(existsSync(join(ws.dir, "__snapshots__", "x.spec.ts.snap"))).toBe(
      true,
    );
    expect(existsSync(join(ws.dir, "__snapshots__", "z.spec.cjs.snap"))).toBe(
      true,
    );
  });

  it("watch mode reruns on edits to a .snap but not on its own writes", async () => {
    const ws = workspace("watch");

    // No __snapshots__ yet, a rerun makes it
    ws.spec(`it("a", () => {});\n`);

    const child = spawn(
      process.execPath,
      [
        resolve(process.cwd(), "bin/unrift.mjs"),
        "--config",
        join(ws.dir, "unrift.config.ts"),
        "--watch",
      ],
      { env: { ...process.env, CI: "" } },
    );
    let output = "";

    child.stdout.on("data", (chunk) => (output += chunk));

    const waitFor = async (text: string, ms = 5000) => {
      const start = Date.now();

      while (!output.includes(text) && Date.now() - start < ms) {
        await new Promise((r) => setTimeout(r, 50));
      }

      return output.includes(text);
    };

    const reruns = () => output.split("re-running").length - 1;

    try {
      expect(await waitFor("for changes")).toBe(true);

      // This rerun writes the first .snap. That write alone mustn't rerun.
      ws.spec(`it("a", () => expect(1).toMatchSnapshot());\n`);
      expect(await waitFor("1 written")).toBe(true);
      await new Promise((r) => setTimeout(r, 600));
      expect(reruns()).toBe(1);

      // Breaking it by hand does, even though the folder is newer than the watcher
      writeFileSync(ws.snapPath, "exports[`a 1`] = `2`;\n");
      const start = Date.now();

      while (reruns() < 2 && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(reruns()).toBe(2);
    } finally {
      child.kill();
    }
  }, 15000);

  it("serializes values like Jest", () => {
    // Escaped, so different values can't print the same
    expect(serialize('say "hi" \\')).toBe('"say \\"hi\\" \\\\"');
    expect(serialize(["a", "b"])).not.toBe(serialize(['a",\n  "b']));

    class Point {
      constructor(public x: number) {}
    }
    const shared = { n: 1 };
    const circular: Record<string, unknown> = { b: 1 };
    circular.self = circular;
    const nullProto = Object.assign(Object.create(null), { z: 1 });

    expect(
      serialize({
        z: [shared, shared],
        a: new Map([[{ k: 1 }, new Set(["v"])]]),
        circular,
        nullProto,
        point: new Point(1),
        // eslint-disable-next-line no-sparse-arrays
        sparse: [, undefined],
        nums: [-0, NaN, 10n, new Uint8Array([1])],
        misc: [new Date(NaN), /x/g, new TypeError(""), function named() {}],
        // Other realms and binary values still print what's in them
        other: [
          runInNewContext("new Map([[1, 2]])"),
          new DataView(new Uint8Array([7]).buffer),
          new Number(1),
        ],
        empty: [{}, [], new Map()],
        [Symbol("s")]: undefined,
      }),
    ).toBe(
      [
        "{",
        '  "a": Map {',
        "    {",
        '      "k": 1,',
        "    } => Set {",
        '      "v",',
        "    },",
        "  },",
        '  "circular": {',
        '    "b": 1,',
        '    "self": [Circular],',
        "  },",
        '  "empty": [',
        "    {},",
        "    [],",
        "    Map {},",
        "  ],",
        '  "misc": [',
        "    Date { NaN },",
        "    /x/g,",
        "    [TypeError],",
        "    [Function named],",
        "  ],",
        '  "nullProto": {',
        '    "z": 1,',
        "  },",
        '  "nums": [',
        "    -0,",
        "    NaN,",
        "    10n,",
        "    Uint8Array [",
        "      1,",
        "    ],",
        "  ],",
        '  "other": [',
        "    Map {",
        "      1 => 2,",
        "    },",
        "    DataView [",
        "      7,",
        "    ],",
        "    [Number: 1],",
        "  ],",
        '  "point": Point {',
        '    "x": 1,',
        "  },",
        '  "sparse": [',
        "    <empty>,",
        "    undefined,",
        "  ],",
        '  "z": [',
        "    {",
        '      "n": 1,',
        "    },",
        "    {",
        '      "n": 1,',
        "    },",
        "  ],",
        "  Symbol(s): undefined,",
        "}",
      ].join("\n"),
    );
  });
});
