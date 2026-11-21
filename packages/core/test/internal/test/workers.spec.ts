import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Result = { description: string; status: string };

function spawnRun(args: string[]) {
  return spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      resolve(process.cwd(), "test/workers/unrift.config.ts"),
      ...args,
    ],
    // A worker that exits without the run noticing would hang it
    { encoding: "utf8", timeout: 20_000 },
  );
}

function run(...args: string[]) {
  const res = spawnRun(["--json", ...args]);

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
    expect(run("--workers", "2", "order").statuses).toEqual([
      "a runs in a worker: pass",
      "b: pass",
      "c: pass",
    ]);
  });

  it("stops the other workers on bail", () => {
    expect(run("--workers", "2", "--bail", "bail").statuses).toEqual([
      "fails: fail",
      "slow: pass",
      "after the bail: skipped",
    ]);
  });

  it("fails the run when a worker exits early, with what it printed", () => {
    // One matching file still runs in a worker
    const res = spawnRun(["--workers", "2", "exit"]);

    expect(res.stderr).toContain(
      "Unrift worker stopped with exit code 3 before it finished",
    );
    expect(res.stdout).toContain("log: before exit");
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

  it("merges inline snapshots from a helper two workers run", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/inline");
    const helper = join(dir, "helper.ts");
    const runWith = (a: string, b: string) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "test"), { recursive: true });
      writeFileSync(
        join(dir, "unrift.config.ts"),
        `export default { testDir: "test" };\n`,
      );
      writeFileSync(
        helper,
        `import { expect } from "@unrift/core";\nexport const check = (value: string) => expect(value).toMatchInlineSnapshot();\n`,
      );

      for (const [name, value] of [
        ["a", a],
        ["b", b],
      ]) {
        writeFileSync(
          join(dir, `test/${name}.spec.ts`),
          `import { it } from "@unrift/core";\nimport { check } from "../helper";\nit("${name}", () => check("${value}"));\n`,
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

      return JSON.parse(res.stdout).snapshots;
    };

    // Written once, not skipped as changed by the other worker
    expect(runWith("same", "same")).toMatchObject({ added: 1, errors: [] });
    expect(readFileSync(helper, "utf8")).toContain(
      'toMatchInlineSnapshot(`"same"`)',
    );

    const conflict = runWith("one", "two");

    expect(conflict.errors[0].message).toContain(
      "ran with different values in different test files",
    );
    expect(readFileSync(helper, "utf8")).toContain("toMatchInlineSnapshot()");
  });

  it("applies .only per file", () => {
    const expected = [
      "only: pass",
      "skipped by only: skipped",
      "runs in a file without only: pass",
    ];

    expect(run("only").statuses).toEqual(expected);
    expect(run("--workers", "2", "only").statuses).toEqual(expected);
  });
});
