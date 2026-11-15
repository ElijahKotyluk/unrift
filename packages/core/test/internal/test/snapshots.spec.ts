import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import {
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

  return {
    snapPath,
    spec(body: string) {
      writeFileSync(
        join(dir, "a.spec.ts"),
        `import { describe, it, expect, beforeAll } from "@unrift/core";\n${body}`,
      );
    },
    snap: () => readFileSync(snapPath, "utf8"),
    run(env: Record<string, string> = {}, ...args: string[]) {
      const res = spawnSync(
        process.execPath,
        [
          resolve(process.cwd(), "bin/unrift.mjs"),
          "--config",
          join(dir, "unrift.config.ts"),
          "--json",
          ...args,
        ],
        // CI is set on GitHub Actions and would stop new snapshots being written
        { encoding: "utf8", env: { ...process.env, CI: "", ...env } },
      );

      return { status: res.status, report: JSON.parse(res.stdout) };
    },
  };
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
        '  "name": "a \\`tick\\` \\${x} \\\\",',
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

    const cleaned = ws.run({}, "-u");

    expect(cleaned.status).toBe(0);
    expect(cleaned.report.snapshots).toMatchObject({ obsolete: 1, removed: 1 });
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

    // A file that fails to import never ran, -u mustn't wipe its snapshots
    const kept = ws.snap();
    ws.spec(`throw new Error("broken");\n`);
    ws.run({}, "-u");

    expect(ws.snap()).toBe(kept);

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

  it("serializes values like Jest", () => {
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
