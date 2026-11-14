import { describe, it, beforeAll } from "@unrift/core";

// Run through --grep "wanted" by test/internal/test/grep.spec.ts. "wanted"
// matches but sits outside the .only, so the hook must not fire.
describe("hooks", () => {
  beforeAll(() => {
    throw new Error("beforeAll should not run when no match can run");
  });

  it.only("focused", () => {});
  it("wanted outside only", () => {});
});
