import { describe, it, expect } from "@unrift/core";

describe("only", () => {
  it.only("should only run this test", () => {
    expect(true).toBe(true);
  });

  it("this test should be skipped", () => {
    expect(true).toBe(false);
  });
});

describe("this suite should be skipped", () => {
  it("this test should be skipped", () => {
    expect(true).toBe(false);
  });
});
