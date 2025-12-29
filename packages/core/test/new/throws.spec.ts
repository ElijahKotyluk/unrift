import { describe, it, expect } from "@unrift/core";
import { runEngine } from "@unrift/core/run";
import { resolve } from "path";

const fixture = (n: string) => resolve(__dirname, "../fixtures", n);

describe("import failures", () => {
  it("records an [import] failure and does not leave pending tests", async () => {
    const res = await runEngine({ files: [fixture("throws.spec.ts")] });

    const importFailure = res.results.find((r) =>
      r.description.includes("> [import]"),
    );
    expect(importFailure?.status).toBe("fail" as any);

    // There should be no pending/running statuses in final results.
    const bad = res.results.filter(
      (r) => r.status === "pending" || r.status === "running",
    );
    expect(bad.length).toBe(0);
  });
});
