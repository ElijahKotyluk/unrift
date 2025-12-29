import { describe, it, expect } from "@unrift/core";
import { runEngine } from "@unrift/core/run";
import { resolve } from "path";

const fixture = (n: string) => resolve(__dirname, "../fixtures", n);

describe(".only semantics", () => {
  it("runs only tests inside only subtrees", async () => {
    const res = await runEngine({ files: [fixture("only.spec.ts")] });

    expect(res.isOnly).toBe(true);

    const ran = res.results.filter((r) => r.status !== "skipped");
    const skipped = res.results.filter((r) => r.status === "skipped");

    // Expect at least one ran and at least one skipped in the fixture.
    expect(ran.length > 0).toBe(true);
    expect(skipped.length > 0).toBe(true);

    // Ensure the non-only test got skipped (by name)
    const nonOnly = res.results.find((r) => r.description.includes("non-only"));
    expect(nonOnly?.status).toBe("skipped" as any);

    const only = res.results.find((r) => r.description.includes("only test"));
    expect(only?.status).toBe("pass" as any);
  });
});
