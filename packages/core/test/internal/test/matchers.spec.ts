import { describe, it, expect } from "@unrift/core";
import { runInNewContext } from "node:vm";

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

  it("toBeCloseTo defaults to 2 digits", () => {
    expect(0.1 + 0.2).toBeCloseTo(0.3);
    expect(1.004).toBeCloseTo(1);
    expect(() => expect(1.006).toBeCloseTo(1)).toThrow();
  });

  it("toBeCloseTo respects precision", () => {
    expect(0.1 + 0.2).toBeCloseTo(0.3, 10);
    expect(() => expect(0.301).toBeCloseTo(0.3, 5)).toThrow();
  });

  it("toBeCloseTo with .not and infinities", () => {
    expect(0.1 + 0.2).not.toBeCloseTo(0.4);
    expect(Infinity).toBeCloseTo(Infinity);
    expect(Infinity).not.toBeCloseTo(-Infinity);
    expect(() => expect("1" as unknown).toBeCloseTo(1)).toThrow();
    expect(() => expect(1).toBeCloseTo("1" as unknown as number)).toThrow(
      "a number for expected",
    );
    expect(() =>
      expect(1).not.toBeCloseTo(2, "x" as unknown as number),
    ).toThrow();
    // Tolerance underflows to 0, so even equal finite values fail.
    expect(1).not.toBeCloseTo(1, 324);
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

  it("toContainEqual compares items deeply", () => {
    expect([{ a: 1 }, { b: [2] }]).toContainEqual({ b: [2] });
    expect(() => expect([{ a: 1 }]).toContainEqual({ a: 2 })).toThrow();
  });

  it("toContainEqual with .not and non-arrays", () => {
    expect([{ a: 1 }]).not.toContainEqual({ a: 2 });
    expect(() => expect([{ a: 1 }]).not.toContainEqual({ a: 1 })).toThrow();
    expect(() => expect("abc").toContainEqual("a")).toThrow();
  });

  it("toContainEqual treats sparse holes as undefined", () => {
    expect(new Array(1)).toContainEqual(undefined);
    expect(() => expect(new Array(1)).not.toContainEqual(undefined)).toThrow();
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

  it("rejects.toThrow matches the rejection reason", async () => {
    const boom = () => Promise.reject(new TypeError("boom"));

    await expect(boom()).rejects.toThrow("boom");
    await expect(boom()).rejects.toThrow(TypeError);
    await expect(boom()).rejects.not.toThrow("other");
    // A function returning a promise works too, like Jest.
    await expect(boom).rejects.toThrow(/boo/);
    await expect(async () => 42).resolves.toBe(42);
    // A real rejection with this exact text must not be mistaken for "it resolved".
    await expect(
      Promise.reject(new Error("Expected promise to reject, but it resolved")),
    ).rejects.toThrow("but it resolved");
  });

  it("rejects/resolves follow Jest for bad input and non-Error reasons", async () => {
    // The assertion's own failure message, or undefined if it passed.
    const failure = (run: () => void | Promise<void>) =>
      Promise.resolve()
        .then(run)
        .then(
          () => undefined,
          (e: Error) => e.message,
        );

    // Bad received values throw right away, even before any await. A sync
    // throw must not count as a rejection (that would pass this toThrow).
    expect(() =>
      expect(() => {
        throw new Error("sync");
      }).rejects.toThrow("sync"),
    ).toThrow("sync");
    expect(() => expect(42).resolves.toBe(42)).toThrow("must be a promise");
    expect(() => expect(() => 42).resolves.toBe(42)).toThrow(
      "must be a promise",
    );

    // Only an Error counts as thrown, including one from another realm.
    expect(
      await failure(() => expect(Promise.reject("boom")).rejects.toThrow()),
    ).toBe(
      "Expected promise to reject with an Error, but it rejected with a non-Error value: boom",
    );
    await expect(Promise.reject("boom")).rejects.not.toThrow();
    await expect(
      Promise.reject(runInNewContext('new Error("boom")')),
    ).rejects.toThrow("boom");
    expect(
      await failure(() => expect(Promise.resolve(1)).resolves.toThrow()),
    ).toBe(
      "Expected promise to resolve with an Error, but it resolved with a non-Error value: 1",
    );
    await expect(Promise.resolve(1)).resolves.not.toThrow();

    // A function as the settled value is called, like a sync toThrow.
    await expect(
      Promise.resolve(() => {
        throw new Error("from fn");
      }),
    ).resolves.toThrow("from fn");

    expect(
      await failure(() =>
        expect(Promise.reject(new TypeError("boom"))).rejects.toThrow(
          RangeError,
        ),
      ),
    ).toBe(
      "Expected promise to reject with RangeError, but it rejected with TypeError: boom",
    );

    // Values String() can't handle must not crash the matcher.
    const nullProto = Object.create(null);
    expect(
      await failure(() =>
        expect(Promise.reject<number>(nullProto)).resolves.toBe(1),
      ),
    ).toContain("Expected promise to resolve, but it rejected with");
    expect(() =>
      expect(() => {
        throw nullProto;
      }).toThrow("x"),
    ).toThrow("Expected function to throw");
  });

  it("custom matchers see which modifier they ran under", async () => {
    expect.extend({
      toRunUnder(_received: unknown, expected: unknown) {
        if (this.promise !== expected) {
          throw new Error(`ran under "${this.promise}"`);
        }
      },
    });
    type WithRunUnder = { toRunUnder(promise: string): void | Promise<void> };

    (expect(1) as unknown as WithRunUnder).toRunUnder("");
    await (
      expect(Promise.resolve(1)).resolves as unknown as WithRunUnder
    ).toRunUnder("resolves");
    await (
      expect(Promise.reject(1)).rejects as unknown as WithRunUnder
    ).toRunUnder("rejects");
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

describe("stateful regex matchers (/g, /y)", () => {
  // RegExp.test advances lastIndex for /g and /y; reusing the same regex
  // object across assertions must not make the matcher flaky.
  it("toMatch is stable when the same /g regex is reused", () => {
    const re = /\d+/g;
    expect("a1").toMatch(re);
    expect("b2").toMatch(re);
    expect("c3").toMatch(re);
  });

  it("toThrow is stable when the same /g regex is reused", () => {
    const re = /boom/g;
    const throwBoom = () => {
      throw new Error("boom happened");
    };
    expect(throwBoom).toThrow(re);
    expect(throwBoom).toThrow(re);
    expect(throwBoom).toThrow({ message: re });
    expect(throwBoom).toThrow({ message: re });
  });
});
