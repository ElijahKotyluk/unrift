import { describe, it, expect } from "@unrift/core";

describe("only fixture", () => {
  it("non-only", () => {
    expect(true).toBe(true);
  });

  it.only("only test", () => {
    expect(2).toBe(2);
  });
});
