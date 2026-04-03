import { describe, it, expect } from "@unrift/core";

// This file is intentionally invalid: describe() with an async callback.
// It is used by the async describe guard integration test.
describe("async suite", async () => {
  it("should not run", () => {
    expect(true).toBe(true);
  });
});
