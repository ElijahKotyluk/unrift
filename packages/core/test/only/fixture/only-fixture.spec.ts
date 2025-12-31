import { it, expect, describe } from "@unrift/core";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function runUnriftJson(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("close", (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

describe(".only fixture", () => {
  it("the /test/only fixture passes", async () => {
    const bin = resolve("bin/unrift.mjs");
    const cfg = resolve("test/only/unrift.config.ts");

    const { code, stdout } = await runUnriftJson([bin, "--config", cfg, "--json"]);

    // inner run passes as expected
    expect(code).toBe(0);

    const report = JSON.parse(stdout) as {
      ok: boolean;
      failed: number;
      passed: number;
      skipped: number;
      total: number;
      files: Array<string>;
      results: Array<{ description: string; status: string; error?: { message: string } }>;
    };

    expect(report.ok).toBe(true);
    expect(report.files.length).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
    expect(report.skipped).toBe(3);
    expect(report.total).toBe(4);

    const passing = report.results.find((result) =>
      result.status === "pass",
    );

    expect(passing?.description).toMatch(/only › should only run this test/);
    expect(passing?.status).toBe("pass");
  });
});
