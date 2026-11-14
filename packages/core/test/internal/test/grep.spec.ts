import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function run(...args: string[]) {
  const proc = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      resolve(process.cwd(), "test/grep/unrift.config.ts"),
      "--json",
      ...args,
    ],
    { encoding: "utf8" },
  );
  const report = JSON.parse(proc.stdout);
  const statusOf = (name: string) =>
    report.results.find((r: { description: string }) =>
      r.description.endsWith(name),
    )?.status;
  return { proc, report, statusOf };
}

describe("--grep", () => {
  it("runs only matching tests and skips the rest", () => {
    const { proc, report, statusOf } = run("--grep", "adds");

    expect(proc.status).toBe(0);
    expect(statusOf("adds numbers")).toBe("pass");
    expect(statusOf("subtracts numbers")).toBe("skipped");
    expect(statusOf("concats")).toBe("skipped");
    expect(report.total).toBe(3);
  });

  it("does not run hooks of suites with no matches", () => {
    const { report } = run("-g", "adds");

    expect(
      report.results.some((r: { description: string }) =>
        r.description.includes("[beforeAll]"),
      ),
    ).toBe(false);
  });

  it("matches against suite names", () => {
    const { statusOf } = run("--grep", "math › sub");

    expect(statusOf("subtracts numbers")).toBe("fail");
    expect(statusOf("adds numbers")).toBe("skipped");
  });
});
