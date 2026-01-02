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

describe("hooks", () => {
  it("should successfully handle failures within hooks", async () => {
    const bin = resolve("bin/unrift.mjs");
    const cfg = resolve("test/hooks/unrift.config.ts");

    const { code, stdout } = await runUnriftJson([
      bin,
      "--config",
      cfg,
      "--json",
    ]);

    expect(code).toBe(1);

    const report = JSON.parse(stdout) as {
      ok: boolean;
      failed: number;
      passed: number;
      skipped: number;
      total: number;
      results: Array<{
        description: string;
        status: string;
        error?: { message: string };
      }>;
    };

    console.log("report:", report);

    const skipped = report.results.filter(result => result.status === "skipped");
    const passed = report.results.filter(result => result.status === "pass");
    const failed = report.results.filter(result => result.status === "fail");

    expect(report.ok).toBe(false);
    expect(failed.length).toBe(2);
    expect(passed.length).toBe(4);
    expect(skipped.length).toBe(2);
    expect(report.total).toBe(8);
  });
});
