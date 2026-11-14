import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// `file` is the positional file pattern, so each test picks its fixture.
function run(file: string, ...args: string[]) {
  const proc = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      resolve(process.cwd(), "test/grep/unrift.config.ts"),
      "--json",
      file,
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
    const { proc, report, statusOf } = run("grep-fixture", "--grep", "adds");

    expect(proc.status).toBe(0);
    expect(statusOf("adds numbers")).toBe("pass");
    expect(statusOf("subtracts numbers")).toBe("skipped");
    expect(statusOf("concats")).toBe("skipped");
    expect(report.total).toBe(3);
  });

  it("does not run hooks of suites with no matches", () => {
    const { report } = run("grep-fixture", "-g", "adds");

    expect(
      report.results.some((r: { description: string }) =>
        r.description.includes("[beforeAll]"),
      ),
    ).toBe(false);
  });

  it("matches against suite names", () => {
    const { statusOf } = run("grep-fixture", "--grep", "math › sub");

    expect(statusOf("subtracts numbers")).toBe("fail");
    expect(statusOf("adds numbers")).toBe("skipped");
  });

  it("does not run hooks when matching tests can't run", () => {
    for (const fixture of ["only-fixture", "skip-fixture"]) {
      const { proc, report } = run(fixture, "--grep", "wanted");

      expect(proc.status).toBe(0);
      expect(report.skipped).toBe(report.total);
    }
  });
});
