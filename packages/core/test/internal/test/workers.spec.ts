import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  commitInlineEdits,
  resetInlineSnapshots,
  takeInlineEdits,
  writeInlineSnapshots,
} from "../../../src/snapshot/inline.js";

type Result = { description: string; status: string };

function spawnRun(args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      resolve(process.cwd(), "test/workers/unrift.config.ts"),
      ...args,
    ],
    // A worker that exits without the run noticing would hang it
    { encoding: "utf8", timeout: 20_000, env: { ...process.env, ...env } },
  );
}

function run(args: string[], env?: Record<string, string>) {
  const res = spawnRun(["--json", ...args], env);

  let results: Result[] = [];

  try {
    results = JSON.parse(res.stdout).results;
  } catch {
    // A run that failed before reporting
  }

  return {
    stderr: res.stderr,
    statuses: results.map(
      (r) => `${r.description.split(" › ").pop()}: ${r.status}`,
    ),
  };
}

describe("workers", () => {
  it("runs files in worker threads and reports them in file order", () => {
    expect(run(["--workers", "2", "order"]).statuses).toEqual([
      "a runs in a worker: pass",
      "b: pass",
      "c: pass",
    ]);
  });

  it("stops the other workers on bail", () => {
    const started = resolve(process.cwd(), "test/workers/.work/bail-started");

    mkdirSync(dirname(started), { recursive: true });
    rmSync(started, { force: true });

    expect(
      run(["--workers", "2", "--bail", "bail"], { BAIL_STARTED: started })
        .statuses,
    ).toEqual(["fails: fail", "slow: pass", "after the bail: skipped"]);
  });

  it("fails the file a worker died in, and the rest still run", () => {
    const errors = (args: string[]) => {
      const res = spawnRun(["--json", ...args]);
      const report = JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));

      return {
        out: res.stdout,
        results: report.results.map(
          (r: {
            description: string;
            status: string;
            error?: { message: string };
          }) =>
            `${r.description.split("/").pop()}: ${r.status}${r.error ? ` (${r.error.message.replace(/\/\S*\//g, "")})` : ""}`,
        ),
      };
    };

    // process.exit() while a test runs. One matching file still gets a worker.
    const exit = errors(["--workers", "2", "exit"]);

    expect(exit.results).toEqual([
      "exit.spec.ts > [worker]: fail (Unrift worker stopped with exit code 3\n\nThe worker stopped while running exit.spec.ts.)",
    ]);
    expect(exit.out).toContain("log: before exit");

    // An error thrown from a timer after the test passed
    expect(errors(["--workers", "2", "crash|order-b"]).results).toEqual([
      "crash.spec.ts › leaks: pass",
      "crash.spec.ts > [worker]: fail (leaked boom\n\nThe worker stopped after running crash.spec.ts.)",
      "order-b.spec.ts › b: pass",
    ]);
  });

  it("keeps what a worker sent before it crashed, and runs every file", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/crash");
    const runWith = (specs: Record<string, string>) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "test"), { recursive: true });
      writeFileSync(
        join(dir, "unrift.config.ts"),
        `export default { testDir: "test" };\n`,
      );

      for (const [name, body] of Object.entries(specs)) {
        writeFileSync(
          join(dir, `test/${name}.spec.ts`),
          `import { it, expect, afterAll } from "@unrift/core";\nconst wait = (ms: number) => new Promise((r) => setTimeout(r, ms));\nvoid expect; void afterAll; void wait;\n${body}\n`,
        );
      }

      const res = spawnSync(
        process.execPath,
        [
          resolve(process.cwd(), "bin/unrift.mjs"),
          "--config",
          join(dir, "unrift.config.ts"),
          "--json",
          "--workers",
          "2",
        ],
        { encoding: "utf8", env: { ...process.env, CI: "" }, timeout: 20_000 },
      );

      return JSON.parse(res.stdout).results.map(
        (r: {
          description: string;
          status: string;
          error?: { message: string };
        }) =>
          `${r.description.split("/").pop()}: ${r.status}${r.error ? ` (${r.error.message.replace(/\/\S*\//g, "")})` : ""}`,
      );
    };

    // The error comes before a's results reach the main thread, c still runs
    expect(
      runWith({
        a: `it("a", () => {});\nafterAll(() => queueMicrotask(() => { throw new Error("boom"); }));`,
        b: `it("b", () => wait(200));`,
        c: `it("c", () => wait(200));`,
      }),
    ).toEqual([
      "a.spec.ts › a: pass",
      "a.spec.ts > [worker]: fail (boom\n\nThe worker stopped after running a.spec.ts.)",
      "b.spec.ts › b: pass",
      "c.spec.ts › c: pass",
    ]);

    // A timer a left throws while the same worker runs c, c says so
    expect(
      runWith({
        a: `it("a", () => { setTimeout(() => { throw new Error("from a"); }, 100); });`,
        b: `it("b", () => wait(1000));`,
        c: `it("c", () => wait(300));`,
      }),
    ).toEqual([
      "a.spec.ts › a: pass",
      "b.spec.ts › b: pass",
      "c.spec.ts > [worker]: fail (from a\n\nThe worker stopped while running c.spec.ts. It can come from a.spec.ts, which ran before it in the same worker.)",
    ]);

    // process.exit() from a timer once a's worker is done, while b still runs
    expect(
      runWith({
        // a waits so the other worker is ready and takes b
        a: `it("a", async () => { await wait(500); setTimeout(() => process.exit(4), 300); });`,
        b: `it("b", () => wait(1500));`,
      }),
    ).toEqual([
      "a.spec.ts › a: pass",
      "a.spec.ts > [worker]: fail (Unrift worker stopped with exit code 4\n\nThe worker stopped after running a.spec.ts.)",
      "b.spec.ts › b: pass",
    ]);

    // a's snapshots are written though its worker dies in c
    runWith({
      a: `it("a", () => { expect(1).toMatchSnapshot(); expect(2).toMatchInlineSnapshot(); });`,
      b: `it("b", () => wait(300));`,
      c: `it("c", () => process.exit(3));`,
    });

    expect(
      readFileSync(join(dir, "test/__snapshots__/a.spec.ts.snap"), "utf8"),
    ).toContain("1");
    expect(readFileSync(join(dir, "test/a.spec.ts"), "utf8")).toContain(
      "toMatchInlineSnapshot(`2`)",
    );
  });

  it("reports a worker that stops outside a file, and keeps the rest", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/outside");
    const runWith = (setup: string, specs: Record<string, string>) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "test"), { recursive: true });
      writeFileSync(join(dir, "setup.mjs"), setup);
      writeFileSync(
        join(dir, "unrift.config.ts"),
        `export default { testDir: "test", matchers: [${JSON.stringify(join(dir, "setup.mjs"))}] };\n`,
      );

      for (const [name, body] of Object.entries(specs)) {
        writeFileSync(
          join(dir, `test/${name}.spec.ts`),
          `import { it, expect, mock } from "@unrift/core";\nimport { writeFileSync } from "node:fs";\nconst wait = (ms: number) => new Promise((r) => setTimeout(r, ms));\nvoid expect; void mock; void writeFileSync; void wait;\n${body}\n`,
        );
      }

      const res = spawnSync(
        process.execPath,
        [
          resolve(process.cwd(), "bin/unrift.mjs"),
          "--config",
          join(dir, "unrift.config.ts"),
          "--json",
          "--workers",
          "2",
        ],
        { encoding: "utf8", env: { ...process.env, CI: "" }, timeout: 20_000 },
      );

      return {
        status: res.status,
        stderr: res.stderr,
        results: JSON.parse(res.stdout).results.map(
          (r: {
            description: string;
            status: string;
            error?: { message: string };
          }) =>
            `${r.description.split("/").pop()}: ${r.status}${r.error ? ` (${r.error.message.replace(/\/\S*\//g, "")})` : ""}`,
        ),
      };
    };

    // A new worker takes over from a and runs c. b still reports.
    const replaced = runWith("", {
      // a waits so the other worker took b
      a: `it("a", async () => { await wait(500); process.exit(2); });`,
      b: `it("b", async () => { await wait(1000); expect(1).toBe(2); });`,
      c: `it("c", () => wait(500));`,
    }).results;

    expect([replaced[0], replaced[2]]).toEqual([
      "a.spec.ts > [worker]: fail (Unrift worker stopped with exit code 2\n\nThe worker stopped while running a.spec.ts.)",
      "c.spec.ts › c: pass",
    ]);
    expect(replaced[1]).toMatch(/^b\.spec\.ts › b: fail/);

    // An error right after the last file's afterAll. One file, one worker.
    const late = runWith(
      `import { afterAll } from "@unrift/core";\nafterAll(() => { setImmediate(() => { throw new Error("late"); }); });\n`,
      { a: `it("a", () => {});` },
    );

    expect(late.status).toBe(1);

    // Each worker stops in its first file, from the matchers module
    const early = runWith(
      `setImmediate(() => { throw new Error("early"); });\n`,
      { a: `it("a", () => {});`, b: `it("b", () => {});` },
    );

    // The matchers module runs with each file, what it throws is that file's
    expect(early.results).toEqual([
      "a.spec.ts > [worker]: fail (early\n\nThe worker stopped while running a.spec.ts.)",
      "b.spec.ts > [worker]: fail (early\n\nThe worker stopped while running b.spec.ts.)",
    ]);

    // A timer's error after its worker's last file, while no other worker
    // runs, still fails the run like without workers
    const timer = runWith("", {
      a: `it("a", () => { setTimeout(() => { throw new Error("timer"); }, 100); });`,
      b: `it("b", () => {});`,
    });

    expect(timer.status).toBe(1);
    expect(timer.results).toEqual([
      "a.spec.ts › a: pass",
      "a.spec.ts > [worker]: fail (timer\n\nThe worker stopped after running a.spec.ts.)",
      "b.spec.ts › b: pass",
    ]);

    // One that never exits is stopped, and says so
    const open = runWith("", {
      a: `it("a", () => { setInterval(() => {}, 1000); });`,
    });

    expect([open.status, open.results]).toEqual([0, ["a.spec.ts › a: pass"]]);
    expect(open.stderr).toMatch(
      /A worker was still running 1000ms after \S*\/test\/a\.spec\.ts, a test left a timer, socket or other handle open\. It was stopped\./,
    );

    // A result that can't be sent fails the file, the worker doesn't wait
    // on it forever
    const unsent = runWith("", {
      a: `process.on("unhandledRejection", () => {});\nit("a", () => { const e = new Error("odd"); Object.defineProperty(e, "name", { value: () => 1 }); throw e; });`,
      b: `it("b", () => {});`,
    });

    expect(unsent.status).toBe(1);
    expect(unsent.results).toEqual([
      "a.spec.ts › a: fail (odd)",
      "b.spec.ts › b: pass",
    ]);

    // Fake timers a test left on don't stop its worker from finishing
    expect(
      runWith("", {
        a: `it("a", () => { mock.useFakeTimers(); });`,
        b: `it("b", () => {});`,
      }).results,
    ).toEqual(["a.spec.ts › a: pass", "b.spec.ts › b: pass"]);
    expect(late.results).toEqual([
      "root > [worker]: fail (late\n\nThe worker stopped after its last file. It can come from a.spec.ts, which ran before it in the same worker.)",
      "a.spec.ts › a: pass",
    ]);
  });

  it("keeps output written after a file's tests with that file", () => {
    const out = spawnRun(["--workers", "2", "late"]).stdout;

    // late-1 logged first, but it comes after late-0 like its tests do
    expect(out.split("\n").filter((line) => line.startsWith("log:"))).toEqual([
      "log: first",
      "log: late",
    ]);
  });

  it("keeps a timer's output with its file once the worker runs another", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/timer");
    // a finishes first and its worker takes c, a's timer logs while c runs
    const specs = {
      a: `it("a", () => { setTimeout(() => console.log("log: a timer"), 200); });`,
      b: `it("b", async () => { await wait(1000); console.log("log: b"); });`,
      c: `it("c", async () => { await wait(500); console.log("log: c"); });`,
    };

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(
      join(dir, "unrift.config.ts"),
      `export default { testDir: "test" };\n`,
    );

    for (const [name, body] of Object.entries(specs)) {
      writeFileSync(
        join(dir, `test/${name}.spec.ts`),
        `import { it } from "@unrift/core";\nconst wait = (ms: number) => new Promise((r) => setTimeout(r, ms));\nvoid wait;\n${body}\n`,
      );
    }

    const { stdout, stderr } = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "bin/unrift.mjs"),
        "--config",
        join(dir, "unrift.config.ts"),
        "--workers",
        "2",
      ],
      {
        encoding: "utf8",
        cwd: dir,
        env: { ...process.env, CI: "" },
        timeout: 20_000,
      },
    );

    // a was printed already, so it goes out right away, not with c
    expect(
      stdout.split("\n").filter((line) => line.startsWith("log:")),
    ).toEqual(["log: a timer", "log: b", "log: c"]);
    // With a note that it's a's, not c's
    expect(
      stderr.split("\n").filter((line) => line.startsWith("Output from")),
    ).toEqual([
      "Output from test/a.spec.ts after its tests were done. Did a test leave a timer running?",
    ]);
  });

  it("fails a file left waiting on what can never settle, and runs the rest", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/stalled");
    const specs = {
      // Nothing keeps the process going, Node would exit as if it passed
      hook: `import { beforeAll, it } from "@unrift/core";\nbeforeAll(() => new Promise(() => {}));\nit("x", () => {});\n`,
      test: `import { it } from "@unrift/core";\nit("before", () => {});\nit("stuck", () => new Promise(() => {}));\nit("after", () => {});\n`,
      top: `await new Promise(() => {});\n`,
      // Only the results decide the exit code
      code: `import { it } from "@unrift/core";\nit("sets it", () => { process.exitCode = 1; });\n`,
    };

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(
      join(dir, "unrift.config.ts"),
      `export default { testDir: "test" };\n`,
    );

    for (const [name, body] of Object.entries(specs)) {
      writeFileSync(join(dir, `test/${name}.spec.ts`), body);
    }

    const run = (...args: string[]) => {
      const res = spawnSync(
        process.execPath,
        [
          resolve(process.cwd(), "bin/unrift.mjs"),
          "--config",
          join(dir, "unrift.config.ts"),
          "--json",
          ...args,
        ],
        { encoding: "utf8", env: { ...process.env, CI: "" }, timeout: 20_000 },
      );

      return {
        status: res.status,
        results: JSON.parse(res.stdout).results.map(
          (r: { description: string; status: string }) =>
            `${r.description.split("/").pop()}: ${r.status}`,
        ),
      };
    };
    const expected = {
      status: 1,
      results: [
        "code.spec.ts › sets it: pass",
        "hook.spec.ts > [stalled]: fail",
        "hook.spec.ts › x: skipped",
        "test.spec.ts › before: pass",
        "test.spec.ts › stuck: fail",
        "test.spec.ts › after: skipped",
        "top.spec.ts > [import]: fail",
      ],
    };

    expect(run()).toEqual(expected);
    expect(run("--workers", "2")).toEqual(expected);

    // Alone, the file that set process.exitCode passes the run
    expect(run("test/code.spec.ts").status).toBe(0);
    expect(run("test/code.spec.ts", "--workers", "2").status).toBe(0);
  });

  it("gives each test file its own copy of the matchers module, the one it imports", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/per-file");

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "test"), { recursive: true });
    // Each counts the tests it ran before, and every run of a beforeEach.
    // A copy shared across files counts on, a second one from the test's
    // own import runs its beforeEach twice. One is CommonJS, which a query
    // in its URL doesn't load again.
    writeFileSync(
      join(dir, "setup.mjs"),
      `import { beforeEach } from "@unrift/core";\nimport { store } from "./store.ts";\nstore.loads++;\nlet n = 0;\nexport const count = () => n;\nbeforeEach(() => { n++; globalThis.runs = (globalThis.runs ?? 0) + 1; });\n`,
    );
    // What it imports is shared with the test too, and starts fresh in
    // each file
    writeFileSync(
      join(dir, "store.ts"),
      `export const store: { loads: number } = { loads: 0 };\n`,
    );
    writeFileSync(
      join(dir, "each.cjs"),
      `const { beforeEach } = require("@unrift/core");\nlet n = 0;\nexports.count = () => n;\nbeforeEach(() => { n++; globalThis.runs = (globalThis.runs ?? 0) + 1; });\n`,
    );
    // From the config's folder
    writeFileSync(
      join(dir, "unrift.config.ts"),
      `export default { testDir: "test", matchers: ["./setup.mjs", "./each.cjs"] };\n`,
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }\n`,
    );
    writeFileSync(join(dir, "other.mjs"), `export const value = 1;\n`);

    const body = (setup: string, more = "") =>
      `import { it, expect, mock } from "@unrift/core";\nimport { count } from "${setup}";\nimport each from "../each.cjs";\nconst start = globalThis.runs ?? 0;\nit("1", () => expect([count(), each.count(), globalThis.runs - start]).toEqual([1, 1, 2]));\nit("2", () => expect([count(), each.count(), globalThis.runs - start]).toEqual([2, 2, 4]));\nimport { store } from "../store.ts";\nit("store", () => expect(store.loads).toBe(1));\n${more}`;

    // Bundled, and loaded by Node
    writeFileSync(join(dir, "test/a.spec.ts"), body("../setup.mjs"));
    writeFileSync(join(dir, "test/b.spec.mjs"), body("../setup.mjs"));
    // By a path alias, and with a mocked module
    writeFileSync(
      join(dir, "test/c.spec.ts"),
      body(
        "@/setup.mjs",
        `import { value } from "../other.mjs";\nmock.module("../other.mjs", () => ({ value: 2 }));\nit("mocked", () => expect(value).toBe(2));\n`,
      ),
    );

    const statuses = (...args: string[]) =>
      JSON.parse(
        spawnSync(
          process.execPath,
          [
            resolve(process.cwd(), "bin/unrift.mjs"),
            "--config",
            join(dir, "unrift.config.ts"),
            "--json",
            ...args,
          ],
          {
            encoding: "utf8",
            env: { ...process.env, CI: "" },
            timeout: 20_000,
          },
        ).stdout,
      ).results.map(
        (r: { description: string; status: string }) =>
          `${r.description.split("/").pop()}: ${r.status}`,
      );
    const expected = [
      "a.spec.ts › 1: pass",
      "a.spec.ts › 2: pass",
      "a.spec.ts › store: pass",
      "b.spec.mjs › 1: pass",
      "b.spec.mjs › 2: pass",
      "b.spec.mjs › store: pass",
      "c.spec.ts › 1: pass",
      "c.spec.ts › 2: pass",
      "c.spec.ts › store: pass",
      "c.spec.ts › mocked: pass",
    ];

    expect(statuses()).toEqual(expected);
    expect(statuses("--workers", "2")).toEqual(expected);

    // Again on a second run in the same process, like watch mode
    const twice = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { runEngine } from ${JSON.stringify(resolve(process.cwd(), "dist/esm/index.js"))};
for (let i = 0; i < 2; i++) {
  const { results } = await runEngine({ files: ["a.spec.ts", "b.spec.mjs", "c.spec.ts"].map((f) => ${JSON.stringify(join(dir, "test"))} + "/" + f), matchers: ${JSON.stringify([join(dir, "setup.mjs"), join(dir, "each.cjs")])} });
  console.log(results.filter((r) => r.status !== "pass").length);
}`,
      ],
      { encoding: "utf8", cwd: dir, timeout: 20_000 },
    );

    expect(twice.stdout.trim().split("\n")).toEqual(["0", "0"]);
  });

  it("runs the top level's beforeAll and afterAll around each file with a test to run", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/root-hooks");

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(
      join(dir, "setup.mjs"),
      `import { appendFileSync } from "node:fs";\nimport { beforeAll, afterAll, beforeEach, afterEach } from "@unrift/core";\nbeforeAll(() => { globalThis.__setup = true; });\nafterAll(() => { throw new Error("after all"); });\nafterAll(() => appendFileSync(${JSON.stringify(join(dir, "after.log"))}, "ran\\n"));\nbeforeEach(() => { globalThis.__each = (globalThis.__each ?? 0) + 1; });\nafterEach(() => { globalThis.__each = 0; });\n`,
    );
    writeFileSync(
      join(dir, "unrift.config.ts"),
      `export default { testDir: "test", matchers: [${JSON.stringify(join(dir, "setup.mjs"))}] };\n`,
    );

    for (const name of ["a", "b"]) {
      writeFileSync(
        join(dir, `test/${name}.spec.ts`),
        `import { it, expect } from "@unrift/core";\nit("${name}", () => expect([(globalThis as Record<string, unknown>).__setup, (globalThis as Record<string, unknown>).__each]).toEqual([true, 1]));\n`,
      );
    }

    // Nothing to run, no hooks: like Jest and Vitest
    writeFileSync(
      join(dir, "test/c.spec.ts"),
      `import { it } from "@unrift/core";\nit.skip("c", () => {});\n`,
    );

    const statuses = (...args: string[]) =>
      JSON.parse(
        spawnSync(
          process.execPath,
          [
            resolve(process.cwd(), "bin/unrift.mjs"),
            "--config",
            join(dir, "unrift.config.ts"),
            "--json",
            ...args,
          ],
          { encoding: "utf8", timeout: 20_000 },
        ).stdout,
      ).results.map(
        (r: { description: string; status: string }) =>
          `${r.description.split("/").pop()}: ${r.status}`,
      );

    // Again on a second run in the same process, like watch mode
    const twice = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { runEngine } from ${JSON.stringify(resolve(process.cwd(), "dist/esm/index.js"))};
for (let i = 0; i < 2; i++) {
  const { results } = await runEngine({ files: [${JSON.stringify(join(dir, "test/a.spec.ts"))}], matchers: [${JSON.stringify(join(dir, "setup.mjs"))}, ${JSON.stringify(join(dir, "setup.mjs"))}] });
  console.log(results.map((r) => r.description.split("/").pop() + ": " + r.status).join(", "));
}`,
      ],
      { encoding: "utf8", timeout: 20_000 },
    );

    // Listed twice, its hooks still run once
    expect(twice.stdout.trim().split("\n")).toEqual([
      "a.spec.ts > [afterAll]: fail, a.spec.ts › a: pass",
      "a.spec.ts > [afterAll]: fail, a.spec.ts › a: pass",
    ]);

    // A matchers module that defines tests is an error on every run
    writeFileSync(
      join(dir, "tests.mjs"),
      `import { it } from "@unrift/core";\nit("in setup", () => {});\n`,
    );

    const tests = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { runEngine } from ${JSON.stringify(resolve(process.cwd(), "dist/esm/index.js"))};
for (let i = 0; i < 2; i++) {
  const { results } = await runEngine({ files: [${JSON.stringify(join(dir, "test/a.spec.ts"))}], matchers: [${JSON.stringify(join(dir, "tests.mjs"))}] });
  console.log(results.map((r) => r.description.split("/").pop() + ": " + r.status + (r.error?.message.includes("defined tests") ? " (defined tests)" : "")).join(", "));
}`,
      ],
      { encoding: "utf8", timeout: 20_000 },
    );

    // The file fails, its tests don't run
    expect(tests.stdout.trim().split("\n")).toEqual([
      "a.spec.ts > [import]: fail (defined tests)",
      "a.spec.ts > [import]: fail (defined tests)",
    ]);

    // Around a and b, with workers or without. The afterAll after the one
    // that threw still runs.
    const ran = () =>
      readFileSync(join(dir, "after.log"), "utf8").split("\n").length - 1;
    const expected = [
      "a.spec.ts > [afterAll]: fail",
      "a.spec.ts › a: pass",
      "b.spec.ts > [afterAll]: fail",
      "b.spec.ts › b: pass",
      "c.spec.ts › c: skipped",
    ];

    expect(ran()).toBe(2);
    expect(statuses("--workers", "2")).toEqual(expected);
    expect(ran()).toBe(4);
    expect(statuses()).toEqual(expected);
    expect(ran()).toBe(6);

    // Nor when --grep leaves nothing to run
    expect(
      statuses("--workers", "2", "--grep", "nothing matches"),
    ).not.toContain("a.spec.ts > [afterAll]: fail");
    expect(statuses("--grep", "nothing matches")).not.toContain(
      "a.spec.ts > [afterAll]: fail",
    );
    expect(ran()).toBe(6);
  });

  it("prints each file's output together, in file order", () => {
    const res = spawnRun(["--workers", "2", "log"]);
    const lines = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("log:"));

    // b ran while a waited, without buffering it'd be in between
    expect(lines(res.stdout)).toEqual([
      "log: a start",
      "log: a end",
      "log: b",
      "log: €€",
      "log: called",
    ]);
    expect(lines(res.stderr)).toEqual(["log: b error"]);
  });

  it("merges inline snapshots from a helper workers share", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/inline");
    const helper = join(dir, "helper.ts");
    // Each file is a list of tests: [name, value, mode]. Mode "skip" skips
    // it, "throw" fails it after the check, "twice" checks at two spots,
    // "wait" only waits.
    const runWith = (files: string[][][], workers = files.length) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "test"), { recursive: true });
      writeFileSync(
        join(dir, "unrift.config.ts"),
        `export default { testDir: "test" };\n`,
      );
      writeFileSync(
        helper,
        `import { expect } from "@unrift/core";\nexport const check = (value: string) => expect(value).toMatchInlineSnapshot();\nexport const twice = (value: string) => { expect(value).toMatchInlineSnapshot(); expect(value).toMatchInlineSnapshot(); };\n`,
      );

      files.forEach((tests, i) => {
        const body = tests
          .map(([name, value, mode]) =>
            mode === "wait"
              ? `it("${name}", () => new Promise((r) => setTimeout(r, 500)));`
              : `it${mode === "skip" ? ".skip" : ""}("${name}", () => { ${mode?.includes("twice") ? "twice" : "check"}("${value}");${mode?.includes("throw") ? ' throw new Error("own");' : ""} });`,
          )
          .join("\n");

        writeFileSync(
          join(dir, `test/${i}.spec.ts`),
          `import { it } from "@unrift/core";\nimport { check, twice } from "../helper";\n${body}\n`,
        );
      });

      const res = spawnSync(
        process.execPath,
        [
          resolve(process.cwd(), "bin/unrift.mjs"),
          "--config",
          join(dir, "unrift.config.ts"),
          "--json",
          "--workers",
          String(workers),
        ],
        { encoding: "utf8", env: { ...process.env, CI: "" }, timeout: 20_000 },
      );
      const report = JSON.parse(res.stdout);

      return {
        failed: report.snapshots.failed,
        statuses: report.results.map(
          (r: {
            description: string;
            status: string;
            error?: { message: string };
          }) =>
            `${r.description.split(" › ").pop()}: ${r.status}${r.error?.message === "own" ? " (own)" : ""}`,
        ),
      };
    };

    // Written once, not skipped as changed by the other worker
    expect(runWith([[["a", "same"]], [["b", "same"]]]).failed).toBe(0);
    expect(readFileSync(helper, "utf8")).toContain(
      'toMatchInlineSnapshot(`"same"`)',
    );

    // Every test at the spot fails, the two with equal values too, but not
    // a skipped test that has the same name
    expect(
      runWith([
        [
          ["a", "one"],
          ["a", "one", "skip"],
        ],
        [["b", "one"]],
        [["c", "two"]],
      ]),
    ).toEqual({
      failed: 3,
      statuses: ["a: fail", "a: skipped", "b: fail", "c: fail"],
    });
    expect(readFileSync(helper, "utf8")).toContain("toMatchInlineSnapshot()");

    // Two files in one worker, while b keeps the other busy: only the later
    // test fails, like a run without workers
    expect(
      runWith([[["a", "one"]], [["b", "", "wait"]], [["c", "two"]]], 2),
    ).toEqual({
      failed: 1,
      statuses: ["a: pass", "b: pass", "c: fail"],
    });

    // A test that found another test's equal value already written fails
    // with them
    expect(
      runWith([
        [
          ["a1", "one"],
          ["a2", "one"],
        ],
        [["b", "two"]],
      ]).statuses,
    ).toEqual(["a1: fail", "a2: fail", "b: fail"]);

    // A worker that conflicts on its own fails the other worker's test too,
    // whichever finishes first
    expect(
      runWith([
        [["a", "one"]],
        [
          ["b", "one"],
          ["c", "two"],
        ],
      ]),
    ).toEqual({
      failed: 3,
      statuses: ["a: fail", "b: fail", "c: fail"],
    });

    // Counted per test and spot, and a test that failed on its own keeps
    // its error but is still counted
    expect(
      runWith([
        [["a", "one", "twice"]],
        [["b", "two", "twice"]],
        [["c", "two", "twice throw"]],
      ]),
    ).toEqual({
      failed: 6,
      statuses: ["a: fail", "b: fail", "c: fail (own)"],
    });
  });

  it("writes nothing to a file workers bundled in two versions", () => {
    const file = resolve(process.cwd(), "test/workers/.work/versions.ts");
    const original = "check(toMatchInlineSnapshot());\n";
    const edit = {
      // Between the parens
      start: 28,
      end: 28,
      value: '"x"',
      indent: "",
      kind: "new" as const,
    };

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, original);

    // The third matches the first again, that mustn't undo the mismatch
    const result = writeInlineSnapshots(
      [original, `// changed\n${original}`, original].map((source, thread) => ({
        thread,
        path: file,
        source,
        edits: [edit],
        missed: false,
      })),
    );

    expect(result.skipped).toEqual([file]);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("sends only what changed since a worker's last take", () => {
    const file = resolve(process.cwd(), "test/workers/.work/takes.ts");
    const line = "check(toMatchInlineSnapshot());\n";
    // Between the parens, on each line
    const spots = [28, line.length + 28];
    const commit = (spot: number, test: string) =>
      commitInlineEdits(
        new Map([
          [
            file,
            new Map([
              [
                spot,
                {
                  start: spot,
                  end: spot,
                  value: '"x"',
                  indent: "",
                  kind: "new",
                },
              ],
            ]),
          ],
        ]),
        test,
      );

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, line + line);
    resetInlineSnapshots();

    commit(spots[0], "t1");
    const first = takeInlineEdits();

    commit(spots[1], "t2");
    const second = takeInlineEdits();

    commit(spots[0], "t3");
    const third = takeInlineEdits();

    // The source once, then the spot that changed with the tests added since
    const sent = (take: typeof first) =>
      take.map((t) => [
        t.source !== undefined,
        t.edits.map((e) => [e.start, e.tests]),
      ]);

    expect([first, second, third, takeInlineEdits()].map(sent)).toEqual([
      [[true, [[spots[0], ["t1"]]]]],
      [[false, [[spots[1], ["t2"]]]]],
      [[false, [[spots[0], ["t3"]]]]],
      [],
    ]);

    // Added up: another thread's value at the first spot fails every test
    // that ran it, the second spot is written
    const other = {
      thread: -1,
      path: file,
      source: line + line,
      edits: [
        {
          start: spots[0],
          end: spots[0],
          value: '"y"',
          indent: "",
          kind: "new" as const,
          tests: ["o"],
        },
      ],
      missed: false,
    };
    const result = writeInlineSnapshots([...first, ...second, ...third, other]);

    expect(result.conflicts.map((c) => c.test).sort()).toEqual([
      "o",
      "t1",
      "t3",
    ]);
    expect(readFileSync(file, "utf8")).toBe(
      line + 'check(toMatchInlineSnapshot(`"x"`));\n',
    );
  });

  it("starts workers with the process's Node flags", () => {
    const files = ["order-a", "order-b"].map((name) =>
      resolve(process.cwd(), `test/workers/fixture/${name}.spec.ts`),
    );
    const code = `import { runEngine } from ${JSON.stringify(resolve(process.cwd(), "dist/esm/index.js"))};
const { results } = await runEngine({ files: ${JSON.stringify(files)}, workers: 2 });
console.log(results.map((r) => r.status).join(","));`;

    // Both ways of passing it, and with a flag a worker only takes from the
    // process
    for (const flag of [
      ["--input-type=module"],
      ["--input-type", "module"],
      ["--input-type=module", "--max-old-space-size=4096"],
    ]) {
      const res = spawnSync(process.execPath, [...flag, "-e", code], {
        encoding: "utf8",
        timeout: 20_000,
      });

      expect(res.stdout.trim()).toBe("pass,pass");
    }

    // And alone, from the CLI
    const cli = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=4096",
        resolve(process.cwd(), "bin/unrift.mjs"),
        "--config",
        resolve(process.cwd(), "test/workers/unrift.config.ts"),
        "--json",
        "--workers",
        "2",
        "order-a|order-b",
      ],
      { encoding: "utf8", timeout: 20_000 },
    );

    expect(JSON.parse(cli.stdout).results.map((r: Result) => r.status)).toEqual(
      ["pass", "pass"],
    );
  });

  it("keeps a spot every test hits cheap", () => {
    const file = resolve(process.cwd(), "test/workers/.work/hot.ts");
    const edit = {
      start: 28,
      end: 28,
      value: '"x"',
      indent: "",
      kind: "same" as const,
    };

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "check(toMatchInlineSnapshot());\n");
    resetInlineSnapshots();

    // Copying the test ids on every commit took seconds here
    const start = performance.now();

    for (let i = 0; i < 50_000; i++) {
      commitInlineEdits(new Map([[file, new Map([[28, edit]])]]), `t${i}`);
      if (i % 100 === 0) takeInlineEdits();
    }

    expect(performance.now() - start).toBeLessThan(500);
  });

  it("applies .only per file", () => {
    const expected = [
      "only: pass",
      "skipped by only: skipped",
      "runs in a file without only: pass",
    ];

    expect(run(["only"]).statuses).toEqual(expected);
    expect(run(["--workers", "2", "only"]).statuses).toEqual(expected);
  });
});
