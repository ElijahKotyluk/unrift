import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { writeInlineSnapshots } from "../../../src/snapshot/inline.js";

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

  it("merges inline snapshots from a helper workers share", () => {
    const dir = resolve(process.cwd(), "test/workers/.work/inline");
    const helper = join(dir, "helper.ts");
    // Each file is a list of tests: [name, value], or [name, value, "skip"]
    const runWith = (files: string[][][]) => {
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

      files.forEach((tests, i) => {
        const body = tests
          .map(
            ([name, value, skip]) =>
              `it${skip ? ".skip" : ""}("${name}", () => check("${value}"));`,
          )
          .join("\n");

        writeFileSync(
          join(dir, `test/${i}.spec.ts`),
          `import { it } from "@unrift/core";\nimport { check } from "../helper";\n${body}\n`,
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
          String(files.length),
        ],
        { encoding: "utf8", env: { ...process.env, CI: "" }, timeout: 20_000 },
      );
      const report = JSON.parse(res.stdout);

      return {
        failed: report.snapshots.failed,
        statuses: report.results.map(
          (r: { description: string; status: string }) =>
            `${r.description.split(" › ").pop()}: ${r.status}`,
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
      [original, `// changed\n${original}`, original].map((source) => ({
        path: file,
        source,
        edits: [edit],
        missed: false,
      })),
    );

    expect(result.skipped).toEqual([file]);
    expect(readFileSync(file, "utf8")).toBe(original);
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
