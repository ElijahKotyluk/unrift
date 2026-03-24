import { it, expect, describe } from "@unrift/core";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function runUnriftJson(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (res) => {
      const child = spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));

      child.on("close", (code) => res({ code: code ?? 0, stdout, stderr }));
    },
  );
}

describe("todo fixture", () => {
  it("should report todo tests with correct status and counts", async () => {
    const bin = resolve("bin/unrift.mjs");
    const cfg = resolve("test/todo/unrift.config.ts");

    const { code, stdout } = await runUnriftJson([
      bin,
      "--config",
      cfg,
      "--json",
    ]);

    expect(code).toBe(0);

    const report = JSON.parse(stdout) as {
      ok: boolean;
      passed: number;
      failed: number;
      skipped: number;
      todo: number;
      total: number;
      results: Array<{
        description: string;
        status: string;
      }>;
    };

    expect(report.ok).toBe(true);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.todo).toBeGreaterThan(0);

    const todoResults = report.results.filter((r) => r.status === "todo");
    expect(todoResults.length).toBeGreaterThan(0);

    for (const r of todoResults) {
      expect(r.status).toBe("todo");
    }
  });
});
