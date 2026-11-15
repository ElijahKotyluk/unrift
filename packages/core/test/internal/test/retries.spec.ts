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

// One JSON run shared by the tests that read results.
let report: { results: { description: string }[] } | undefined;
function result(name: string) {
  report ??= JSON.parse(run("--json").stdout);
  return report!.results.find((r) => r.description.endsWith(name)) as any;
}

describe("retries", () => {
  it("retries failed tests and reports attempts", () => {
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
    // A passing retry must not keep the earlier attempt's error.
    expect(result("flaky").error).toBeUndefined();
  });

  it("retries hook failures", () => {
    for (const name of ["recovers from setup", "recovers from teardown"]) {
      expect(result(name)).toMatchObject({ status: "pass", attempts: 2 });
      expect(result(name).error).toBeUndefined();
    }

    // Timeouts aren't retried: the first body may still be running.
    expect(result("times out").status).toBe("fail");
    expect(result("times out").attempts).toBeUndefined();
    expect(result("times out").error.message).toContain("teardown failed");
    expect(result("times out").error.message).toContain("not retried");
  });

  it("shows the attempt count in the output", () => {
    const out = run().stdout;

    expect(out).toContain("(passed after 3 attempts)");
    expect(out).toContain("(failed after 3 attempts)");
    expect(out).toContain(
      "not retried: the timed-out attempt may still be running",
    );
  });

  it("rejects invalid retries before running anything", () => {
    // Run in a child process: a bad runEngine call in-process would clear the
    // registry this test is running in.
    const proc = runWith("unrift.invalid.config.ts");

    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain("retries must be a non-negative integer");
  });
});
