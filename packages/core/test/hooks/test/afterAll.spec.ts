import { describe, it, afterAll, expect } from "@unrift/core";

describe("afterAll failure", () => {
  it("passes", () => {
    expect(1).toBe(1);
  });

  afterAll(() => {
    throw new Error("Failure in afterAll");
  });
});
