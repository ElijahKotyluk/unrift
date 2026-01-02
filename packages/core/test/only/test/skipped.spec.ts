import { describe, it, expect } from "@unrift/core";

describe("this suite should be skipped", () => {
  it("this test should be skipped", () => {
    expect(true).toBe(false);
  });

  it.only("should pass", () => {
    expect(true).toBe(true);
  });
});
