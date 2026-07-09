import { describe, it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Integration test for the `unrift` wrapper package's bin. The module tests in
// module.spec.ts run through @unrift/core's own bin, which registers the loader
// - so they can't catch a wrapper bin that forgets to. This spawns the actual
// wrapper bin against a fixture that uses mock.doMock, proving the loader is
// wired end-to-end for users who install `unrift` rather than `@unrift/core`.
//
// cwd during `test:internal` is packages/core, so paths are relative to it.
describe("unrift wrapper bin - module mocking", () => {
  it("registers the loader so mock.doMock works through the wrapper", () => {
    const wrapperBin = resolve(process.cwd(), "../unrift/bin/unrift.mjs");
    const config = resolve(process.cwd(), "test/wrapper/unrift.config.ts");

    const proc = spawnSync(
      process.execPath,
      [wrapperBin, "--config", config, "--json"],
      { encoding: "utf8" },
    );

    // Surface the subprocess output if it didn't produce parseable JSON.
    let report: { ok?: boolean; passed?: number };
    try {
      report = JSON.parse(proc.stdout);
    } catch {
      throw new Error(
        `wrapper bin did not emit JSON.\nstdout:\n${proc.stdout}\nstderr:\n${proc.stderr}`,
      );
    }

    expect(report.ok).toBe(true);
    expect(report.passed).toBeGreaterThan(0);
  });
});
