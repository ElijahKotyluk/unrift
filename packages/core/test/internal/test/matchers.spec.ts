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

describe("numeric matchers", () => {
  it("toBeGreaterThan passes", () => {
    expect(5).toBeGreaterThan(3);
  });

  it("toBeGreaterThan fails", () => {
    expect(() => expect(2).toBeGreaterThan(5)).toThrow();
  });

  it("toBeGreaterThan with .not", () => {
    expect(2).not.toBeGreaterThan(5);
    expect(() => expect(5).not.toBeGreaterThan(3)).toThrow();
  });

  it("toBeLessThan passes", () => {
    expect(3).toBeLessThan(5);
  });

  it("toBeLessThan fails", () => {
    expect(() => expect(5).toBeLessThan(2)).toThrow();
  });

  it("toBeLessThan with .not", () => {
    expect(5).not.toBeLessThan(2);
    expect(() => expect(3).not.toBeLessThan(5)).toThrow();
  });
});

describe("collection matchers", () => {
  it("toContain works with arrays", () => {
    expect([1, 2, 3]).toContain(2);
    expect(() => expect([1, 2, 3]).toContain(4)).toThrow();
  });

  it("toContain works with strings", () => {
    expect("hello world").toContain("world");
    expect(() => expect("hello").toContain("xyz")).toThrow();
  });

  it("toContain with .not", () => {
    expect([1, 2]).not.toContain(3);
    expect(() => expect([1, 2]).not.toContain(1)).toThrow();
  });

  it("toHaveLength works with arrays", () => {
    expect([1, 2, 3]).toHaveLength(3);
    expect(() => expect([1]).toHaveLength(2)).toThrow();
  });

  it("toHaveLength works with strings", () => {
    expect("abc").toHaveLength(3);
  });

  it("toHaveLength with .not", () => {
    expect([1, 2]).not.toHaveLength(5);
    expect(() => expect([1, 2]).not.toHaveLength(2)).toThrow();
  });
});

describe("toBeInstanceOf", () => {
  it("passes for matching constructor", () => {
    expect(new Error("x")).toBeInstanceOf(Error);
    expect(new Map()).toBeInstanceOf(Map);
  });

  it("fails for non-matching constructor", () => {
    expect(() => expect({}).toBeInstanceOf(Array)).toThrow();
  });

  it("works with .not", () => {
    expect("hello").not.toBeInstanceOf(Number);
    expect(() => expect(new Error()).not.toBeInstanceOf(Error)).toThrow();
  });
});

describe("async matchers", () => {
  it("resolves.toBe works", async () => {
    await expect(Promise.resolve(42)).resolves.toBe(42);
  });

  it("resolves.toEqual works", async () => {
    await expect(Promise.resolve({ a: 1 })).resolves.toEqual({ a: 1 });
  });

  it("resolves fails when promise rejects", async () => {
    try {
      await expect(Promise.reject(new Error("oops"))).resolves.toBe(42);
      throw new Error("should not reach here");
    } catch (err) {
      expect((err as Error).message).toContain("Expected promise to resolve");
    }
  });

  it("rejects.toBeInstanceOf works", async () => {
    await expect(Promise.reject(new Error("boom"))).rejects.toBeInstanceOf(
      Error,
    );
  });

  it("rejects.toBe works with non-Error rejection", async () => {
    await expect(Promise.reject("oops")).rejects.toBe("oops");
  });

  it("rejects fails when promise resolves", async () => {
    try {
      await expect(Promise.resolve(42)).rejects.toBe("anything");
      throw new Error("should not reach here");
    } catch (err) {
      expect((err as Error).message).toContain("Expected promise to reject");
    }
  });
});
