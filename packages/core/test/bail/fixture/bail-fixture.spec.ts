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

describe("bail fixture", () => {
  it("should successfully bail and skip remaining tests after failing", async () => {
    const bin = resolve("bin/unrift.mjs");
    const cfg = resolve("test/bail/unrift.config.ts");

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
      total: number;
      bail?: boolean;
      results: Array<{
        description: string;
        status: string;
        error?: { message: string };
      }>;
      skipped: number;
    };

    expect(report.bail).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.total).toBe(3);

    const failing = report.results.find((result) =>
      result.description.endsWith("bail › fails"),
    );

    expect(failing?.status).toBe("fail");
  });
});
