import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function run(...args: string[]) {
  return runWith("unrift.config.ts", ...args);
}

function runWith(config: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      resolve(process.cwd(), "test/retries", config),
      ...args,
    ],
    { encoding: "utf8" },
  );
}

describe("retries", () => {
  it("retries failed tests and reports attempts", () => {
    const report = JSON.parse(run("--json").stdout);
    const result = (name: string) =>
      report.results.find((r: { description: string }) =>
        r.description.endsWith(name),
      );

    expect(result("flaky")).toMatchObject({ status: "pass", attempts: 3 });
    expect(result("always fails")).toMatchObject({
      status: "fail",
      attempts: 3,
    });
    expect(result("uses config default")).toMatchObject({
      status: "pass",
      attempts: 2,
    });
    expect(result("opts out").status).toBe("fail");
    expect(result("opts out").attempts).toBeUndefined();
  });

  it("shows the attempt count in the output", () => {
    const out = run().stdout;

    expect(out).toContain("(passed after 3 attempts)");
    expect(out).toContain("(failed after 3 attempts)");
  });

  it("rejects invalid retries before running anything", () => {
    // Run in a child process: a bad runEngine call in-process would clear the
    // registry this test is running in.
    const proc = runWith("unrift.invalid.config.ts");

    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain("retries must be a non-negative integer");
  });
});
