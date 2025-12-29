import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "child_process";
import { resolve } from "path";

function runUnrift(args: string[], cwd: string) {
  const bin = resolve(__dirname, "../../dist/cli.js");
  
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("CLI --json", () => {
  it("produces valid JSON and exits 0 on pass", () => {
    const cwd = resolve(__dirname, "../fixtures-projects/pass-project");
    const process = runUnrift(["--json"], cwd);

    expect(process.status).toBe(0);

    const parsed = JSON.parse(process.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.failed).toBe(0);
  });
});
