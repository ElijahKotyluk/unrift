import { describe, it, expect } from "@unrift/core";
import { runEngine } from "@unrift/core/run";
import { resolve } from "path";

function fixture(name: string) {
  return resolve(__dirname, "../fixtures", name);
}

describe("runEngine", () => {
  it("passes a simple file", async () => {
    const res = await runEngine({
      files: [fixture("pass.spec.ts")],
    });

    expect(res.isOnly).toBe(false);

    const failed = res.results.filter((r) => r.status === "fail");
    expect(failed.length).toBe(0);
  });

  it("reports a failing test", async () => {
    const res = await runEngine({
      files: [fixture("fail.spec.ts")],
    });

    const failed = res.results.filter((r) => r.status === "fail");
    expect(failed.length).toBe(1);
    expect(failed[0].description).toMatch("fails");
  });
});
