import { describe, it, expect } from "@unrift/core";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("timeout", () => {
  it("times out", async () => {
    await sleep(50);
  });

  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
