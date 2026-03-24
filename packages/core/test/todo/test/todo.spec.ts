import { describe, it, expect } from "@unrift/core";

describe("todo suite", () => {
  it("passes normally", () => {
    expect(1).toBe(1);
  });

  it.todo("implement this later");

  it.todo("also not ready");
});

describe.todo("future feature");
