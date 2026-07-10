import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
  spy,
  spyOn,
  isSpy,
} from "@unrift/core";

// Reset mock registries between every test so spies from one suite
// don't leak into another.
beforeEach(() => {
  mock.restoreAll();
});

describe("mock namespace surface", () => {
  it("exposes every documented member (pins the public API shape)", () => {
    // A missing key here means the docs reference `mock.x` but users get
    // undefined - exactly the listMockedSpecs regression. An extra key means
    // something shipped undocumented. Update deliberately, with docs.
    expect(Object.keys(mock).sort()).toEqual(
      [
        "advanceTimersByTime",
        "advanceTimersByTimeAsync",
        "class",
        "clearAll",
        "doMock",
        "fetch",
        "fetchOnce",
        "fn",
        "fromModule",
        "fs",
        "getRealSystemTime",
        "getTimerCount",
        "global",
        "listMockedSpecs",
        "object",
        "resetAll",
        "restoreAll",
        "runAllTimers",
        "runAllTimersAsync",
        "runOnlyPendingTimers",
        "runOnlyPendingTimersAsync",
        "setSystemTime",
        "spyOn",
        "stub",
        "unmock",
        "useFakeTimers",
        "useRealTimers",
      ].sort(),
    );
  });
});

describe("spy() - basic call recording", () => {
  it("records arguments for every call, in invocation order", () => {
    const fn = spy();
    fn(1, "two", { three: 3 });
    fn("b");
    expect(fn.mock.calls).toEqual([[1, "two", { three: 3 }], ["b"]]);
  });

  it("exposes lastCall as a shortcut to the most recent args", () => {
    const fn = spy();
    fn(1);
    fn(2);
    expect(fn.mock.lastCall).toEqual([2]);
  });

  it("records return values", () => {
    const fn = spy(() => 42);
    fn();
    expect(fn.mock.results).toEqual([{ type: "return", value: 42 }]);
  });

  it("records thrown values", () => {
    const fn = spy(() => {
      throw new Error("boom");
    });
    expect(() => fn()).toThrow("boom");
    expect(fn.mock.results).toHaveLength(1);
    expect(fn.mock.results[0].type).toBe("throw");
  });

  it("invokes the provided implementation by default", () => {
    const fn = spy((x: number) => x * 2);
    expect(fn(21)).toBe(42);
  });

  it("returns undefined when no implementation is provided", () => {
    const fn = spy();
    expect(fn()).toBe(undefined);
  });
});

describe("spy() - implementation control", () => {
  it("mockReturnValue sets a permanent return value", () => {
    const fn = spy();
    fn.mockReturnValue("hello");
    expect(fn()).toBe("hello");
    expect(fn()).toBe("hello");
  });

  it("mockReturnValueOnce queues a single-use return", () => {
    const fn = spy();
    fn.mockReturnValueOnce("first").mockReturnValueOnce("second");
    fn.mockReturnValue("default");

    expect(fn()).toBe("first");
    expect(fn()).toBe("second");
    expect(fn()).toBe("default");
    expect(fn()).toBe("default");
  });

  it("mockImplementation replaces behavior", () => {
    const fn = spy(() => "original");
    fn.mockImplementation(() => "replaced");
    expect(fn()).toBe("replaced");
  });

  it("mockImplementationOnce wins over mockImplementation for one call", () => {
    const fn = spy<() => string>();
    fn.mockImplementation(() => "permanent");
    fn.mockImplementationOnce(() => "once");

    expect(fn()).toBe("once");
    expect(fn()).toBe("permanent");
  });

  it("mockResolvedValue returns a promise", async () => {
    const fn = spy<() => Promise<number>>();
    fn.mockResolvedValue(7);
    expect(await fn()).toBe(7);
  });

  it("mockRejectedValue returns a rejecting promise", async () => {
    const fn = spy<() => Promise<unknown>>();
    fn.mockRejectedValue(new Error("nope"));
    await expect(fn()).rejects.toBeInstanceOf(Error);
  });

  it("mockName is reflected in getMockName", () => {
    const fn = spy().mockName("myFn");
    expect(fn.getMockName()).toBe("myFn");
  });
});

describe("spy() - lifecycle", () => {
  it("mockClear wipes call state but preserves implementation", () => {
    const fn = spy<() => string>().mockReturnValue("kept");
    fn();
    fn();
    fn.mockClear();

    expect(fn.mock.calls).toEqual([]);
    expect(fn.mock.results).toEqual([]);
    expect(fn()).toBe("kept");
  });

  it("mockReset clears state AND implementation", () => {
    const fn = spy<() => string>().mockReturnValue("temp");
    fn();
    fn.mockReset();

    expect(fn.mock.calls).toEqual([]);
    expect(fn()).toBe(undefined);
  });
});

describe("spy() - construction (new spy())", () => {
  // Spies are callable functions, so `new spy()` is always valid JS. These
  // pin the constructor path: it must never throw on a non-constructable impl,
  // and mock.instances must record the actual constructed instance.

  it("new spy() with no impl records and returns the real instance", () => {
    const Ctor = spy();
    const inst = new (Ctor as unknown as new () => object)();

    expect(typeof inst).toBe("object");
    expect(Ctor.mock.instances).toHaveLength(1);
    expect(Ctor.mock.instances[0]).toBe(inst); // not undefined
  });

  it("new spy(arrowImpl) does not throw (non-constructable impl)", () => {
    const Ctor = spy(() => {});
    let inst: object | undefined;

    expect(() => {
      inst = new (Ctor as unknown as new () => object)();
    }).not.toThrow();
    expect(Ctor.mock.instances[0]).toBe(inst);
  });

  it("a non-constructable impl can initialize the instance via `this`", () => {
    const method = {
      init(this: { ready?: boolean }) {
        this.ready = true;
      },
    }.init; // object-shorthand method - not constructable

    const Ctor = spy(method);
    const inst = new (Ctor as unknown as new () => { ready?: boolean })();

    expect(inst.ready).toBe(true);
    expect(Ctor.mock.instances[0]).toBe(inst);
  });

  it("an impl returning an object overrides the instance (constructor return semantics)", () => {
    const tag = { tagged: true };
    const Ctor = spy(() => tag);
    const inst = new (Ctor as unknown as new () => object)();

    expect(inst).toBe(tag);
    expect(Ctor.mock.instances[0]).toBe(tag);
  });

  it("a constructable impl still runs as the constructor", () => {
    function Real(this: { x?: number }, x: number) {
      this.x = x;
    }
    const Ctor = spy(Real);
    const inst = new (Ctor as unknown as new (x: number) => { x: number })(42);

    expect(inst.x).toBe(42);
    expect(Ctor.mock.instances[0]).toBe(inst);
  });
});

describe("isSpy()", () => {
  it("returns true for spy() and mock.fn(), which are the same primitive", () => {
    expect(isSpy(spy())).toBe(true);
    expect(isSpy(mock.fn())).toBe(true);
  });

  it("returns false for unbranded functions and non-functions", () => {
    expect(isSpy(() => 1)).toBe(false);
    expect(isSpy(42)).toBe(false);
    expect(isSpy({})).toBe(false);
    expect(isSpy(null)).toBe(false);
  });
});

describe("spyOn() - method wrapping", () => {
  it("wraps an object method while preserving behavior", () => {
    const obj = {
      greet(name: string) {
        return `hi ${name}`;
      },
    };
    const s = spyOn(obj, "greet");

    expect(obj.greet("world")).toBe("hi world");
    expect(s.mock.calls).toEqual([["world"]]);
  });

  it("allows overriding the wrapped behavior", () => {
    const obj = {
      double(x: number) {
        return x * 2;
      },
    };
    spyOn(obj, "double").mockReturnValue(99);

    expect(obj.double(5)).toBe(99);
  });

  it("mockRestore restores the original method", () => {
    const obj = {
      ping() {
        return "pong";
      },
    };
    const original = obj.ping;
    const s = spyOn(obj, "ping");
    s.mockReturnValue("FAKE");

    expect(obj.ping()).toBe("FAKE");

    s.mockRestore();

    expect(obj.ping).toBe(original);
    expect(obj.ping()).toBe("pong");
  });

  it("throws when the property is not a function", () => {
    const obj = { count: 1 };
    expect(() => spyOn(obj as never, "count" as never)).toThrow(
      "spyOn() requires a function property",
    );
  });

  it("repeat spyOn on the same method returns the existing spy", () => {
    const obj = {
      m() {
        return "REAL";
      },
    };
    const realFn = obj.m;

    const first = spyOn(obj, "m").mockReturnValue("s1");
    const second = spyOn(obj, "m");

    // Same spy object - not a spy wrapping a spy.
    expect(second).toBe(first);

    // And restoreAll puts the REAL method back, not the first spy.
    mock.restoreAll();
    expect(obj.m).toBe(realFn);
    expect(obj.m()).toBe("REAL");
  });

  it("repeat spyOn on the same getter returns the existing spy", () => {
    const obj = {
      get v() {
        return "REAL";
      },
    };

    const first = spyOn(obj, "v", "get").mockReturnValue("fake");
    const second = spyOn(obj, "v", "get");
    expect(second).toBe(first);

    mock.restoreAll();
    expect(obj.v).toBe("REAL");
  });

  it("mockRestore followed by restoreAll does not clobber the method (idempotent)", () => {
    const obj = {
      m() {
        return "REAL";
      },
    };
    const realFn = obj.m;

    const s = spyOn(obj, "m");
    s.mockRestore();
    mock.restoreAll(); // second restore of the same registration - must no-op

    expect(obj.m).toBe(realFn);
  });
});

describe("mock.restoreAll / clearAll / resetAll", () => {
  it("clearAll resets call state on every active spy", () => {
    const a = spy();
    const b = spy();
    a();
    b();
    mock.clearAll();

    expect(a.mock.calls).toEqual([]);
    expect(b.mock.calls).toEqual([]);
  });

  it("resetAll clears state and implementation on every spy", () => {
    const a = spy<() => string>().mockReturnValue("hello");
    a();
    mock.resetAll();

    expect(a.mock.calls).toEqual([]);
    expect(a()).toBe(undefined);
  });

  it("restoreAll restores every spyOn target", () => {
    const obj = {
      foo() {
        return "real-foo";
      },
      bar() {
        return "real-bar";
      },
    };
    const realFoo = obj.foo;
    const realBar = obj.bar;

    spyOn(obj, "foo").mockReturnValue("fake-foo");
    spyOn(obj, "bar").mockReturnValue("fake-bar");

    mock.restoreAll();

    expect(obj.foo).toBe(realFoo);
    expect(obj.bar).toBe(realBar);
  });
});

describe("mock.stub / mock.global", () => {
  it("stub replaces a property and the restorer puts it back", () => {
    const obj = { name: "original" };
    const restore = mock.stub(obj, "name", "replaced");

    expect(obj.name).toBe("replaced");

    restore();

    expect(obj.name).toBe("original");
  });

  it("stub adds a new property when one didn't exist, and removes it on restore", () => {
    const obj: Record<string, unknown> = {};
    const restore = mock.stub(obj, "added", 42);

    expect(obj.added).toBe(42);

    restore();

    expect("added" in obj).toBe(false);
  });

  it("mock.global stubs values on globalThis", () => {
    const fakeFetch = spy();
    const restore = mock.global("__unrift_test_fetch__", fakeFetch);

    expect(
      (globalThis as Record<string, unknown>).__unrift_test_fetch__,
    ).toBe(fakeFetch);

    restore();

    expect("__unrift_test_fetch__" in globalThis).toBe(false);
  });

  it("mock.restoreAll undoes stubs along with spies", () => {
    const obj = { value: 1 };
    mock.stub(obj, "value", 999);
    expect(obj.value).toBe(999);

    mock.restoreAll();
    expect(obj.value).toBe(1);
  });

  it("re-stubbing the same key keeps the true original for restore", () => {
    const obj = { k: "REAL" };

    mock.stub(obj, "k", "v1");
    mock.stub(obj, "k", "v2"); // must not capture "v1" as the original

    expect(obj.k).toBe("v2");

    mock.restoreAll();
    expect(obj.k).toBe("REAL");
  });

  it("throws when the property is non-configurable", () => {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "locked", {
      value: 1,
      configurable: false,
      writable: false,
    });

    expect(() => mock.stub(obj, "locked", 2)).toThrow(
      "non-configurable property",
    );
  });
});

describe("mock.object - auto-mocking", () => {
  it("replaces every method with a spy", () => {
    const service = {
      get() {
        return "real";
      },
      put() {
        return "real";
      },
    };
    mock.object(service);

    expect(isSpy(service.get)).toBe(true);
    expect(isSpy(service.put)).toBe(true);
  });

  it("walks prototype chain for class instances", () => {
    class Service {
      static create() {
        return new Service();
      }
      handle() {
        return "real";
      }
    }
    const instance = new Service();
    mock.object(instance);

    expect(isSpy(instance.handle)).toBe(true);
  });

  it("ignores non-function properties", () => {
    const obj = { name: "x", count: 1, run() {} };
    mock.object(obj);

    expect(obj.name).toBe("x");
    expect(obj.count).toBe(1);
    expect(isSpy(obj.run)).toBe(true);
  });

  it("methods are restorable via mock.restoreAll", () => {
    class Service {
      handle() {
        return "real";
      }
    }
    const instance = new Service();
    const original = Service.prototype.handle;
    mock.object(instance);

    mock.restoreAll();

    expect(Service.prototype.handle).toBe(original);
  });
});

describe("mock.class - auto-mocking constructors", () => {
  it("auto-spies static methods on the constructor", () => {
    class Service {
      static factory() {
        return new Service();
      }
      run() {
        return "real";
      }
    }
    mock.class(Service);

    expect(isSpy(Service.factory)).toBe(true);
  });

  it("instances created via the proxied constructor have spied methods", () => {
    class Service {
      run() {
        return "real";
      }
    }
    const Mocked = mock.class(Service);
    const instance = new Mocked();

    expect(isSpy(instance.run)).toBe(true);
  });

  it("preserves instanceof relationship", () => {
    class Service {}
    const Mocked = mock.class(Service);
    const instance = new Mocked();
    expect(instance instanceof Service).toBe(true);
  });

  it("each instance gets its own spy with per-instance call state", () => {
    class Service {
      run() {
        return "REAL";
      }
    }
    const Mocked = mock.class(Service);
    const a = new Mocked();
    const b = new Mocked();

    a.run();
    a.run();
    b.run();

    // Separate spies - a's calls must not include b's.
    expect(a.run).not.toBe(b.run);
    expect(a.run).toHaveBeenCalledTimes(2);
    expect(b.run).toHaveBeenCalledTimes(1);
  });

  it("never mutates the class prototype (nothing to restore or leak)", () => {
    class Service {
      run() {
        return "REAL";
      }
    }
    const realRun = Service.prototype.run;

    const Mocked = mock.class(Service);
    new Mocked();
    new Mocked(); // second construction must not re-spy anything shared

    // Prototype untouched even before restore...
    expect(Service.prototype.run).toBe(realRun);

    mock.restoreAll();

    // ...and after. Un-mocked instances are unaffected throughout.
    expect(Service.prototype.run).toBe(realRun);
    expect(isSpy(Service.prototype.run)).toBe(false);
    expect(new Service().run()).toBe("REAL");
  });
});

describe("mock matchers", () => {
  it("toHaveBeenCalled - pass and fail paths", () => {
    const fn = spy();
    expect(() => expect(fn).toHaveBeenCalled()).toThrow();

    fn();
    expect(fn).toHaveBeenCalled();
  });

  it("toHaveBeenCalled.not", () => {
    const fn = spy();
    expect(fn).not.toHaveBeenCalled();
    fn();
    expect(() => expect(fn).not.toHaveBeenCalled()).toThrow();
  });

  it("toHaveBeenCalledTimes", () => {
    const fn = spy();
    fn();
    fn();
    fn();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(() => expect(fn).toHaveBeenCalledTimes(2)).toThrow();
  });

  it("toHaveBeenCalledWith uses deep equality", () => {
    const fn = spy();
    fn({ id: 1 }, [2, 3]);

    expect(fn).toHaveBeenCalledWith({ id: 1 }, [2, 3]);
    expect(() => expect(fn).toHaveBeenCalledWith({ id: 2 })).toThrow();
  });

  it("toHaveBeenLastCalledWith only inspects the last call", () => {
    const fn = spy();
    fn("a");
    fn("b");

    expect(fn).toHaveBeenLastCalledWith("b");
    expect(() => expect(fn).toHaveBeenLastCalledWith("a")).toThrow();
  });

  it("toHaveBeenNthCalledWith uses 1-indexed access", () => {
    const fn = spy();
    fn("first");
    fn("second");
    fn("third");

    expect(fn).toHaveBeenNthCalledWith(1, "first");
    expect(fn).toHaveBeenNthCalledWith(3, "third");
    expect(() => expect(fn).toHaveBeenNthCalledWith(2, "wrong")).toThrow();
  });

  it("toHaveReturned distinguishes return from throw", () => {
    const ok = spy(() => 1);
    ok();
    expect(ok).toHaveReturned();

    const bad = spy(() => {
      throw new Error("x");
    });
    expect(() => bad()).toThrow();
    expect(() => expect(bad).toHaveReturned()).toThrow();
  });

  it("toHaveReturnedWith uses deep equality on return values", () => {
    const fn = spy(() => ({ result: "ok" }));
    fn();
    expect(fn).toHaveReturnedWith({ result: "ok" });
    expect(() => expect(fn).toHaveReturnedWith({ result: "fail" })).toThrow();
  });

  it("toHaveReturnedTimes counts only successful returns", () => {
    let attempt = 0;
    const fn = spy(() => {
      attempt++;
      if (attempt === 2) throw new Error("flaky");
      return attempt;
    });

    fn();
    expect(() => fn()).toThrow();
    fn();

    // 3 calls, but only 2 returned (call #2 threw)
    expect(fn).toHaveReturnedTimes(2);
    expect(() => expect(fn).toHaveReturnedTimes(3)).toThrow();
  });

  it("toHaveLastReturnedWith inspects the most recent return", () => {
    const fn = spy<(x: number) => number>((x) => x * 10);
    fn(1);
    fn(2);
    fn(3);

    expect(fn).toHaveLastReturnedWith(30);
    expect(() => expect(fn).toHaveLastReturnedWith(20)).toThrow();
  });

  it("toHaveLastReturnedWith fails clearly when the last call threw", () => {
    const fn = spy(() => {
      throw new Error("boom");
    });
    expect(() => fn()).toThrow();
    expect(() => expect(fn).toHaveLastReturnedWith(undefined)).toThrow(
      "last call threw",
    );
  });

  it("toHaveLastReturnedWith fails clearly when there were no calls", () => {
    const fn = spy();
    expect(() => expect(fn).toHaveLastReturnedWith(undefined)).toThrow(
      "no calls",
    );
  });

  it("toHaveNthReturnedWith uses 1-indexed access", () => {
    const fn = spy<(x: string) => string>((x) => x.toUpperCase());
    fn("a");
    fn("b");
    fn("c");

    expect(fn).toHaveNthReturnedWith(1, "A");
    expect(fn).toHaveNthReturnedWith(3, "C");
    expect(() => expect(fn).toHaveNthReturnedWith(2, "wrong")).toThrow();
  });

  it("toHaveNthReturnedWith fails clearly when the nth call threw", () => {
    let attempt = 0;
    const fn = spy(() => {
      attempt++;
      if (attempt === 2) throw new Error("nope");
      return attempt;
    });
    fn();
    expect(() => fn()).toThrow();
    fn();

    expect(() => expect(fn).toHaveNthReturnedWith(2, undefined)).toThrow(
      "call #2 threw",
    );
  });

  it("toHaveNthReturnedWith fails clearly on missing call", () => {
    const fn = spy(() => 1);
    fn();
    expect(() => expect(fn).toHaveNthReturnedWith(5, 1)).toThrow(
      "call #5 not found",
    );
  });

  it("toHaveNthReturnedWith rejects invalid n", () => {
    const fn = spy(() => 1);
    fn();
    expect(() => expect(fn).toHaveNthReturnedWith(0, 1)).toThrow(
      "1-indexed integer",
    );
    expect(() => expect(fn).toHaveNthReturnedWith(-1, 1)).toThrow();
    expect(() => expect(fn).toHaveNthReturnedWith(1.5, 1)).toThrow();
  });

  it("matcher rejects non-spy received values with a clear error", () => {
    expect(() => expect(() => 1).toHaveBeenCalled()).toThrow(
      "requires a spy or mock function",
    );
    expect(() => expect(42 as unknown).toHaveBeenCalled()).toThrow(
      "requires a spy or mock function",
    );
  });
});

describe("spyOn - getter/setter spies (3-arg form)", () => {
  it("spyOn(obj, key, 'get') records every read", () => {
    const obj = {
      _value: 42,
      get value() {
        return this._value;
      },
    };

    const getSpy = spyOn(obj, "value", "get");

    expect(obj.value).toBe(42);
    expect(obj.value).toBe(42);

    expect(getSpy.mock.calls).toHaveLength(2);
    expect(getSpy.mock.results[0]).toEqual({ type: "return", value: 42 });
  });

  it("getter spy can override the returned value", () => {
    const obj = {
      get value() {
        return "real";
      },
    };

    spyOn(obj, "value", "get").mockReturnValue("fake");
    expect(obj.value).toBe("fake");
  });

  it("spyOn(obj, key, 'set') records every assignment", () => {
    const sink: number[] = [];
    const obj = {
      set value(v: number) {
        sink.push(v);
      },
    };

    const setSpy = spyOn(obj, "value", "set");

    obj.value = 1;
    obj.value = 2;
    obj.value = 3;

    expect(setSpy.mock.calls).toEqual([[1], [2], [3]]);
    // The pass-through still happens by default.
    expect(sink).toEqual([1, 2, 3]);
  });

  it("setter spy can suppress the original via mockImplementation", () => {
    const sink: number[] = [];
    const obj = {
      set value(v: number) {
        sink.push(v);
      },
    };

    spyOn(obj, "value", "set").mockImplementation(() => {
      /* swallow */
    });
    obj.value = 99;

    expect(sink).toEqual([]);
  });

  it("spyOn finds the descriptor on a prototype, not just the instance", () => {
    class Holder {
      _x = 0;
      get x() {
        return this._x;
      }
      set x(v: number) {
        this._x = v;
      }
    }

    const inst = new Holder();
    const getSpy = spyOn(Holder.prototype, "x", "get");

    inst.x;
    expect(getSpy.mock.calls).toHaveLength(1);
  });

  it("restoring undoes both the getter and setter when only one is spied", () => {
    const obj = {
      _v: 1,
      get v() {
        return this._v;
      },
      set v(n: number) {
        this._v = n;
      },
    };

    const getSpy = spyOn(obj, "v", "get").mockReturnValue(99);
    expect(obj.v).toBe(99);

    obj.v = 5; // setter still works because we only spied the getter
    expect(obj._v).toBe(5);

    getSpy.mockRestore();
    expect(obj.v).toBe(5); // original getter returns real value again
  });

  it("throws on a property without the requested accessor", () => {
    const obj = {
      get value() {
        return 1;
      },
    };

    expect(() => spyOn(obj, "value", "set")).toThrow(
      'requires "value" to have a setter',
    );
  });

  it("throws when the property doesn't exist anywhere in the chain", () => {
    const obj = {};
    expect(() =>
      spyOn(obj as never, "missing" as never, "get"),
    ).toThrow("could not find property");
  });
});

describe("mock.fromModule - whole-module auto-mock", () => {
  it("returns mocked exports with every function as a spy", async () => {
    const path = await mock.fromModule<typeof import("node:path")>("node:path");

    expect(isSpy(path.join)).toBe(true);
    expect(isSpy(path.dirname)).toBe(true);
  });

  it("non-function exports are preserved", async () => {
    const path = await mock.fromModule<typeof import("node:path")>("node:path");

    // `sep` and `delimiter` are strings, not functions
    expect(typeof path.sep).toBe("string");
    expect(typeof path.delimiter).toBe("string");
  });

  it("auto-mocked functions return undefined by default (no call-through)", async () => {
    const path = await mock.fromModule<typeof import("node:path")>("node:path");

    // Must NOT execute the real path.join - an unconfigured export records
    // the call and returns undefined, so real side effects never fire.
    expect(path.join("a", "b")).toBe(undefined);
    expect(path.join).toHaveBeenCalledWith("a", "b");
  });

  it("registers via doMock so await import returns customizable spies", async () => {
    const path = await mock.fromModule<typeof import("node:path")>("node:path");
    path.join.mockReturnValue("CUSTOM");

    const fresh = await import("node:path");
    expect(fresh.join("a", "b")).toBe("CUSTOM");
  });

  it("rejects an empty specifier", async () => {
    let err: Error | undefined;
    try {
      await mock.fromModule("");
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toContain("non-empty string specifier");
  });
});
