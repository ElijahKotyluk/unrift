import { it, expect, describe } from "@unrift/core";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function runUnriftJson(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (res) => {
      const child = spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));

      child.on("close", (code) => res({ code: code ?? 1, stdout, stderr }));
    },
  );
}

describe(".only fixture", () => {
  it("runs only the tasks marked with .only", async () => {
    const bin = resolve("bin/unrift.mjs");
    const cfg = resolve("test/only/unrift.config.ts");

    const { code, stdout } = await runUnriftJson([
      bin,
      "--config",
      cfg,
      "--json",
    ]);

    // inner run passes as expected
    expect(code).toBe(0);

    const report = JSON.parse(stdout) as {
      ok: boolean;
      failed: number;
      passed: number;
      skipped: number;
      total: number;
      files: Array<string>;
      results: Array<{
        description: string;
        status: string;
        error?: { message: string };
      }>;
    };

    expect(report.ok).toBe(true);
    expect(report.files.length).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(2);
    expect(report.skipped).toBe(3);
    expect(report.total).toBe(5);

    const passing = report.results.filter((result) => result.status === "pass");

    expect(passing.length).toBe(2);
    
    for (const passingTest of passing) {
      expect(passingTest.description).toMatch(/› should pass/);
    }
  });
});
