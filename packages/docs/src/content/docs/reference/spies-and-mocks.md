---
title: Spies and Mocks
description: Replace functions with test doubles using spy, spyOn, and auto-mock helpers.
---

Unrift ships a built-in spy/mock primitive plus convenience helpers for auto-mocking objects and classes, stubbing arbitrary properties, and asserting calls with `expect`.

Everything lives under a single `mock` namespace, with named exports for the most-used pieces:

```ts
import { mock, spy, spyOn, expect } from "unrift";
```

## Creating a spy

`spy()` (or `mock.fn()`) returns a callable that records every invocation. Without an implementation it returns `undefined`; pass one to control the return value.

```ts
import { spy } from "unrift";

const fn = spy();
fn("a", "b");
expect(fn).toHaveBeenCalledWith("a", "b");

const greet = spy((name: string) => `hi ${name}`);
expect(greet("alice")).toBe("hi alice");
```

The spy records every call in `fn.mock`:

| Property | Description |
| --- | --- |
| `mock.calls` | Array of argument arrays, in invocation order |
| `mock.results` | `{ type: "return" \| "throw", value }` per call |
| `mock.lastCall` | Shortcut for the most recent argument list |
| `mock.contexts` | The `this` binding for each call |
| `mock.instances` | Instances produced when the spy was invoked with `new` |

## Configuring return values

The implementation can be controlled three ways. Permanent overrides win until cleared; "once" variants form a FIFO queue and are consumed first.

```ts
const fn = spy<() => string>();

fn.mockReturnValue("default");
fn.mockReturnValueOnce("first");
fn.mockReturnValueOnce("second");

fn(); // → "first"
fn(); // → "second"
fn(); // → "default"
```

For async code:

```ts
const fetchUser = spy<() => Promise<{ id: number }>>();
fetchUser.mockResolvedValue({ id: 1 });
fetchUser.mockRejectedValueOnce(new Error("transient"));
```

For full control:

```ts
const fn = spy<(x: number) => number>();
fn.mockImplementation((x) => x * 10);
fn.mockImplementationOnce(() => 0);
```

## Wrapping a method with spyOn

`spyOn(obj, method)` replaces `obj.method` with a spy that records calls and **passes through to the original by default**. Override via `.mockReturnValue` / `.mockImplementation`; restore via `.mockRestore()` or `mock.restoreAll()`.

```ts
import { spyOn } from "unrift";

const service = {
  greet(name: string) {
    return `hello ${name}`;
  },
};

const greetSpy = spyOn(service, "greet");

service.greet("world");
expect(greetSpy).toHaveBeenCalledWith("world");

greetSpy.mockRestore();
service.greet("world"); // → "hello world" again
```

### Spying on getters and setters

The 3-arg form wraps an accessor instead of a method:

```ts
const obj = {
  _value: 1,
  get value() {
    return this._value;
  },
  set value(v: number) {
    this._value = v;
  },
};

// Spy the getter
const getSpy = spyOn(obj, "value", "get").mockReturnValue(99);
expect(obj.value).toBe(99);

// Spy the setter — assigned values become spy call arguments
const setSpy = spyOn(obj, "value", "set");
obj.value = 42;
expect(setSpy.mock.calls).toEqual([[42]]);
```

`spyOn` walks the prototype chain to find the descriptor, so spying on a class's getter at the prototype level applies to every instance:

```ts
class Holder {
  get x() { return 1; }
}
spyOn(Holder.prototype, "x", "get").mockReturnValue(99);
new Holder().x; // → 99
```

## Auto-mocking whole objects and classes

For test doubles that replace every method at once:

```ts
import { mock } from "unrift";

const realApi = {
  getUser: () => ({ id: 1 }),
  deleteUser: () => true,
};

mock.object(realApi);

realApi.getUser();
expect(realApi.getUser).toHaveBeenCalled();
expect(realApi.deleteUser).not.toHaveBeenCalled();
```

`mock.object()` walks own and prototype methods (stopping at `Object.prototype` / `Function.prototype`), so it works on class instances too. Non-function properties are left untouched. Constructor wrapping for classes:

```ts
class Service {
  static factory() {
    return new Service();
  }
  run() {
    return "real";
  }
}

const MockedService = mock.class(Service);
const instance = new MockedService();

expect(instance.run).toHaveBeenCalledTimes(0);
instance.run();
expect(instance.run).toHaveBeenCalledTimes(1);
expect(instance instanceof Service).toBe(true);
```

## Stubbing arbitrary properties

`mock.stub(target, key, value)` replaces any property — function or non-function — and returns a restore function. `mock.global(key, value)` is shorthand for `mock.stub(globalThis, key, value)`.

```ts
const restore = mock.stub(process, "platform", "linux");
expect(process.platform).toBe("linux");
restore();
```

```ts
mock.global("fetch", spy().mockResolvedValue(new Response("mocked")));
```

Both forms participate in `mock.restoreAll()`.

## Mock matchers

The full matcher set, all of which require `received` to be a spy/mock:

| Matcher | Pass condition |
| --- | --- |
| `.toHaveBeenCalled()` | Spy was called at least once |
| `.toHaveBeenCalledTimes(n)` | Spy was called exactly `n` times |
| `.toHaveBeenCalledWith(...args)` | Some call's args deeply equal `args` |
| `.toHaveBeenLastCalledWith(...args)` | The most recent call deeply equals `args` |
| `.toHaveBeenNthCalledWith(n, ...args)` | The `n`th call (1-indexed) deeply equals `args` |
| `.toHaveReturned()` | At least one call returned (didn't throw) |
| `.toHaveReturnedTimes(n)` | Exactly `n` calls returned (excluding throws) |
| `.toHaveReturnedWith(value)` | A returned value deeply equals `value` |
| `.toHaveLastReturnedWith(value)` | The most recent call returned a value deeply equal to `value` |
| `.toHaveNthReturnedWith(n, value)` | The `n`th call (1-indexed) returned a value deeply equal to `value` |

For `mock.fetch` specifically there are two additional matchers — see [Request Mocking](./request-mocking#matchers).

All matchers support `.not`:

```ts
expect(fn).not.toHaveBeenCalledWith("forbidden");
```

Passing a non-spy throws a clear error explaining the matcher needs a spy or mock.

## Lifecycle: clear, reset, restore

| Call | Effect |
| --- | --- |
| `spy.mockClear()` | Wipe call state, keep the implementation |
| `spy.mockReset()` | Wipe state and remove all configured implementations |
| `spy.mockRestore()` | For `spyOn` only — restore the original method on the host object |
| `mock.clearAll()` | `mockClear` every active spy |
| `mock.resetAll()` | `mockReset` every active spy |
| `mock.restoreAll()` | Restore every `spyOn`/`stub`/`fetch`/`useFakeTimers`/`doMock` registration, then reset every spy |

The idiomatic cleanup pattern is `afterEach`:

```ts
import { afterEach, mock } from "unrift";

afterEach(() => {
  mock.restoreAll();
});
```

## When to use which

- **`spy()`** — standalone callable for tests that don't have an object to spy on (e.g. callback invocation count).
- **`spyOn(obj, method)`** — assert that real code called a specific method, optionally pass through to the real implementation.
- **`mock.object` / `mock.class`** — replace an entire dependency at once, then customize individual methods with `.mockReturnValue`.
- **`mock.stub` / `mock.global`** — swap non-function values or temporarily set globals like `process.env.NODE_ENV` or `globalThis.fetch`.
