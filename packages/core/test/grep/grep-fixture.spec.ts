import { describe, it, expect, beforeAll } from "@unrift/core";

// Run through --grep "adds" by test/internal/test/grep.spec.ts.
describe("math", () => {
  it("adds numbers", () => {
    expect(1 + 1).toBe(2);
  });

  it("subtracts numbers", () => {
    throw new Error("should be skipped by --grep");
  });
});

describe("strings", () => {
  beforeAll(() => {
    throw new Error("beforeAll should not run when nothing matches");
  });

  it("concats", () => {
    expect("a" + "b").toBe("ab");
  });
});
