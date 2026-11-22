import { describe, it, beforeAll, afterAll } from "@unrift/core";

// Run without --grep by test/internal/test/grep.spec.ts. No test can run,
// so neither hook fires, like Jest and Vitest.
describe("hooks", () => {
  beforeAll(() => {
    throw new Error("beforeAll should not run when no test can run");
  });
  afterAll(() => {
    throw new Error("afterAll should not run when no test can run");
  });

  it.skip("skipped", () => {});
  it.todo("todo");

  describe.skip("child", () => {
    it("in skipped suite", () => {});
  });
});
