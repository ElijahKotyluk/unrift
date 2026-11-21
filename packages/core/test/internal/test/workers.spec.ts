import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

type Result = { description: string; status: string };

function run(...args: string[]) {
  const res = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      resolve(process.cwd(), "test/workers/unrift.config.ts"),
      "--json",
      ...args,
    ],
    // A worker that exits without the run noticing would hang it
    { encoding: "utf8", timeout: 20_000 },
  );

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
