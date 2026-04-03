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
      await expect(Promise.reject<number>(new Error("oops"))).resolves.toBe(42);
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

  it("resolves.not works with async proxy", async () => {
    await expect(Promise.resolve(42)).resolves.not.toBe(99);
  });

  it("rejects.not works with async proxy", async () => {
    await expect(Promise.reject(new Error("boom"))).rejects.not.toBe("other");
  });

  it("toThrow detects async functions and gives helpful error", () => {
    const result = expect(() =>
      expect(async () => {
        throw new Error("x");
      }).toThrow(),
    ).toThrow("toThrow() received an async function");
  });
});

describe("toBeGreaterThanOrEqual / toBeLessThanOrEqual", () => {
  it("toBeGreaterThanOrEqual passes on equal value", () => {
    expect(5).toBeGreaterThanOrEqual(5);
  });

  it("toBeGreaterThanOrEqual passes on greater value", () => {
    expect(10).toBeGreaterThanOrEqual(5);
  });

  it("toBeGreaterThanOrEqual fails when less", () => {
    expect(() => expect(3).toBeGreaterThanOrEqual(5)).toThrow();
  });

  it("toBeGreaterThanOrEqual with .not", () => {
    expect(3).not.toBeGreaterThanOrEqual(5);
    expect(() => expect(5).not.toBeGreaterThanOrEqual(5)).toThrow();
  });

  it("toBeLessThanOrEqual passes on equal value", () => {
    expect(5).toBeLessThanOrEqual(5);
  });

  it("toBeLessThanOrEqual passes on lesser value", () => {
    expect(3).toBeLessThanOrEqual(5);
  });

  it("toBeLessThanOrEqual fails when greater", () => {
    expect(() => expect(10).toBeLessThanOrEqual(5)).toThrow();
  });

  it("toBeLessThanOrEqual with .not", () => {
    expect(10).not.toBeLessThanOrEqual(5);
    expect(() => expect(5).not.toBeLessThanOrEqual(5)).toThrow();
  });
});

describe("toBeNaN / toBeFinite", () => {
  it("toBeNaN passes for NaN", () => {
    expect(NaN).toBeNaN();
    expect(0 / 0).toBeNaN();
  });

  it("toBeNaN fails for non-NaN", () => {
    expect(() => expect(1).toBeNaN()).toThrow();
  });

  it("toBeNaN with .not", () => {
    expect(1).not.toBeNaN();
    expect(() => expect(NaN).not.toBeNaN()).toThrow();
  });

  it("toBeFinite passes for finite numbers", () => {
    expect(42).toBeFinite();
    expect(0).toBeFinite();
    expect(-1.5).toBeFinite();
  });

  it("toBeFinite fails for Infinity", () => {
    expect(() => expect(Infinity).toBeFinite()).toThrow();
    expect(() => expect(-Infinity).toBeFinite()).toThrow();
  });

  it("toBeFinite fails for NaN", () => {
    expect(() => expect(NaN).toBeFinite()).toThrow();
  });

  it("toBeFinite with .not", () => {
    expect(Infinity).not.toBeFinite();
    expect(() => expect(1).not.toBeFinite()).toThrow();
  });
});

describe("toMatchObject", () => {
  it("exact match passes", () => {
    expect({ a: 1, b: 2 }).toMatchObject({ a: 1, b: 2 });
  });

  it("partial match passes (extra keys in received)", () => {
    expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
  });

  it("fails when expected has keys missing from received", () => {
    expect(() => expect({ a: 1 }).toMatchObject({ a: 1, b: 2 })).toThrow();
  });

  it("fails when value does not match", () => {
    expect(() => expect({ a: 1 }).toMatchObject({ a: 2 })).toThrow();
  });

  it("nested partial match", () => {
    expect({ user: { name: "Alice", age: 30 } }).toMatchObject({
      user: { name: "Alice" },
    });
  });

  it("fails nested mismatch", () => {
    expect(() =>
      expect({ user: { name: "Alice" } }).toMatchObject({
        user: { name: "Bob" },
      }),
    ).toThrow();
  });

  it("array in expected must match exactly", () => {
    expect({ items: [1, 2, 3] }).toMatchObject({ items: [1, 2, 3] });
    expect(() =>
      expect({ items: [1, 2] }).toMatchObject({ items: [1, 2, 3] }),
    ).toThrow();
  });

  it("with .not", () => {
    expect({ a: 1 }).not.toMatchObject({ b: 2 });
    expect(() => expect({ a: 1 }).not.toMatchObject({ a: 1 })).toThrow();
  });

  it("throws when received is not an object", () => {
    expect(() => expect("string").toMatchObject({ a: 1 })).toThrow();
    expect(() => expect(null).toMatchObject({ a: 1 })).toThrow();
  });
});

describe("toHaveProperty", () => {
  const obj = { a: 1, b: { c: 2, d: { e: 3 } } };

  it("passes when property exists", () => {
    expect(obj).toHaveProperty("a");
    expect(obj).toHaveProperty("b");
  });

  it("fails when property is missing", () => {
    expect(() => expect(obj).toHaveProperty("x")).toThrow();
  });

  it("dot-notation path", () => {
    expect(obj).toHaveProperty("b.c");
    expect(obj).toHaveProperty("b.d.e");
  });

  it("array path", () => {
    expect(obj).toHaveProperty(["b", "c"]);
    expect(obj).toHaveProperty(["b", "d", "e"]);
  });

  it("with value check passes", () => {
    expect(obj).toHaveProperty("a", 1);
    expect(obj).toHaveProperty("b.c", 2);
  });

  it("with value check fails on wrong value", () => {
    expect(() => expect(obj).toHaveProperty("a", 99)).toThrow();
  });

  it("with .not", () => {
    expect(obj).not.toHaveProperty("x");
    expect(obj).not.toHaveProperty("a", 99);
    expect(() => expect(obj).not.toHaveProperty("a")).toThrow();
  });

  it("throws when received is not an object", () => {
    expect(() => expect(42).toHaveProperty("a")).toThrow();
  });
});
