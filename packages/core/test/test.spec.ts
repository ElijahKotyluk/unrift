import { describe, it, expect, beforeEach } from "@unrift/core";

describe("Sample Test Suite", () => {
  let value: number = 0;

  beforeEach(() => {
    value = 42;
  });

  it("should pass this test", () => {
    expect(1 + 1).not.toBe(value);
  });

  it("should have value set to 42", () => {
    expect(value).toBe(42);
  });
});

describe("Failing Test Suite", () => {
  it("should fail this test", () => {
    expect(1 + 1).toBe(3);
  });
});

describe("toStrictEqual", () => {
  it("should correctly compare complex objects", () => {
    const obj1 = {
      name: "Test",
      data: [1, 2, 3],
      nested: {
        flag: true,
        regex: /test/i,
      },
      map: new Map([
        ["key1", "value1"],
        ["key2", "value2"],
      ]),
      set: new Set([1, 2, 3]),
      typedArray: new Uint8Array([1, 2, 3]),
    };

    const obj2 = {
      name: "Test",
      data: [1, 2, 3],
      nested: {
        flag: true,
        regex: /test/i,
      },
      map: new Map([
        ["key1", "value1"],
        ["key2", "value2"],
      ]),
      set: new Set([1, 2, 3]),
      typedArray: new Uint8Array([1, 2, 3]),
    };

    expect(obj1).toStrictEqual(obj2);
  });
});
