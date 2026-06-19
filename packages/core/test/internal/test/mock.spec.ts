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

describe("spy() — basic call recording", () => {
  it("returns a callable function", () => {
    const fn = spy();
    expect(typeof fn).toBe("function");
  });

  it("records call arguments", () => {
    const fn = spy();
    fn(1, "two", { three: 3 });
    expect(fn.mock.calls).toEqual([[1, "two", { three: 3 }]]);
  });

  it("records every call in invocation order", () => {
    const fn = spy();
    fn("a");
    fn("b");
    fn("c");
    expect(fn.mock.calls).toEqual([["a"], ["b"], ["c"]]);
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

describe("spy() — implementation control", () => {
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

describe("spy() — lifecycle", () => {
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

describe("isSpy()", () => {
  it("returns true for spy()", () => {
    expect(isSpy(spy())).toBe(true);
  });

  it("returns true for mock.fn()", () => {
    expect(isSpy(mock.fn())).toBe(true);
  });

  it("returns false for plain functions", () => {
    expect(isSpy(() => 1)).toBe(false);
  });

  it("returns false for non-function values", () => {
    expect(isSpy(42)).toBe(false);
    expect(isSpy("not a spy")).toBe(false);
    expect(isSpy({})).toBe(false);
    expect(isSpy(null)).toBe(false);
  });
});

describe("spyOn() — method wrapping", () => {
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

describe("mock.object — auto-mocking", () => {
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

  it("mocked methods record calls", () => {
    const service = {
      send(payload: unknown) {
        return payload;
      },
    };
    mock.object(service);
    service.send({ a: 1 });

    expect((service.send as unknown as { mock: { calls: unknown[][] } }).mock.calls).toEqual([
      [{ a: 1 }],
    ]);
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

describe("mock.class — auto-mocking constructors", () => {
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
});

describe("mock matchers", () => {
  it("toHaveBeenCalled — pass and fail paths", () => {
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

  it("matcher rejects non-spy received values with a clear error", () => {
    expect(() => expect(() => 1).toHaveBeenCalled()).toThrow(
      "requires a spy or mock function",
    );
    expect(() => expect(42 as unknown).toHaveBeenCalled()).toThrow(
      "requires a spy or mock function",
    );
  });
});
