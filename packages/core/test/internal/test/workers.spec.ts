import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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

  it("fails the run when a worker exits early", () => {
    // With one file there'd be one worker, run on the main thread
    expect(run("--workers", "2", "exit|order-c").stderr).toContain(
      "Unrift worker stopped with exit code 3 before it finished",
    );
  });

  it("prints each file's output together, in file order", () => {
    const res = spawnRun(["--workers", "2", "log"]);
    const lines = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("log:"));

    // b ran while a waited, without buffering it'd be in between
    expect(lines(res.stdout)).toEqual(["log: a start", "log: a end", "log: b"]);
    expect(lines(res.stderr)).toEqual(["log: b error"]);
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
