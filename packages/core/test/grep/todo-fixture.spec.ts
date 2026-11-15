import { describe, it } from "@unrift/core";

// Run through --grep "wanted" by test/internal/test/grep.spec.ts.
describe("pruned", () => {
  it.todo("wanted todo alone");
});

describe("entered", () => {
  it("wanted runnable", () => {});
  it.todo("unrelated todo");
});
