import { describe, it, beforeAll } from "@unrift/core";

// Run through --grep "wanted" by test/internal/test/grep.spec.ts. Every
// "wanted" test is skipped, so the hook must not fire.
describe("hooks", () => {
  beforeAll(() => {
    throw new Error("beforeAll should not run when no match can run");
  });

  it("unrelated", () => {});
  it.skip("wanted but skipped", () => {});

  describe.skip("child", () => {
    it("wanted in skipped suite", () => {});
  });
});
