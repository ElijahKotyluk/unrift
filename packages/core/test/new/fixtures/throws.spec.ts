import { describe, it, expect } from "@unrift/core";

describe("partial registration", () => {
  it("registered before crash", () => {
    expect(1).toBe(1);
  });
});

throw new Error("Error during import");
