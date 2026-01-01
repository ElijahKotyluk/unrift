import { describe, it, expect } from "@unrift/core";

describe("core matchers", () => {
  it("toBe passes on Object.is()", () => {
    expect(1).toBe(1);
    expect(NaN).toBe(NaN);
  });

  it("toBe fails", () => {
    expect(() => expect(1).toBe(2)).toThrow();
  });

  it("not chaining works", () => {
    expect(1).not.toBe(2);
    expect(() => expect(1).not.toBe(1)).toThrow();
  });

  it("toStrictEqual uses deepEqual (prototype-sensitive)", () => {
    class A {
      x = 1;
    }
    class B {
      x = 1;
    }

    expect(new A()).not.toStrictEqual(new B());
  });

  it("toEqual is loose (prototype-insensitive, missing ≈ undefined)", () => {
    class A {
      x = 1;
    }
    expect(new A()).toEqual({ x: 1 });
    expect({}).toEqual({ a: undefined });
  });

  it("toThrow supports string / regex / ctor", () => {
    expect(() => {
      throw new Error("hello world");
    }).toThrow("hello");
    expect(() => {
      throw new Error("hello world");
    }).toThrow(/world/);

    class MyErr extends Error {}
    expect(() => {
      throw new MyErr("x");
    }).toThrow(MyErr);
  });

  it("toThrow supports non-Error throws", () => {
    expect(() => {
      throw "boom";
    }).toThrow("boom");
  });

  it("unknown matcher throws a helpful error", () => {
    expect(() => (expect(1) as any).toFrobnicate()).toThrow("Unknown matcher");
  });
});
