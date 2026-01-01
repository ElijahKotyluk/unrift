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

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      child.on("close", (code) => res({ code: code ?? 0, stdout, stderr }));
    },
  );
}

describe("hooks fixture", () => {
  it("the hooks tests should handle failures but still pass ci", async () => {
    const bin = resolve("bin/unrift.mjs");
    const cfg = resolve("test/fail/unrift.config.ts");

    const { code, stdout } = await runUnriftJson([
      bin,
      "--config",
      cfg,
      "--json",
    ]);

    // inner run fails as expected
    expect(code).toBe(1);

    const report = JSON.parse(stdout) as {
      ok: boolean;
      failed: number;
      passed: number;
      total: number;
      results: Array<{
        description: string;
        status: string;
        error?: { message: string };
      }>;
    };

    expect(report.ok).toBe(false);
    expect(report.failed).toBe(1);
    expect(report.total).toBe(1);

    const failing = report.results.find((result) =>
      result.description.endsWith("› should fail as expected"),
    );

    expect(failing?.status).toBe("fail");
  });
});
