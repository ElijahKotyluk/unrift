/**
 * Spy / Mock function primitive.
 *
 * Both `spy()` and `mock.fn()` produce the same object - a callable that
 * records every invocation, supports configurable implementations, and can
 * be restored to the original (when created via `spyOn`).
 */

export const SPY_BRAND: unique symbol = Symbol.for("unrift.spy");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFn = (...args: any[]) => any;

export interface MockResult {
  type: "return" | "throw";
  value: unknown;
}

export interface MockState {
  // Arguments passed to each call, in invocation order.
  calls: unknown[][];
  // Return value or thrown error for each call, in invocation order.
  results: MockResult[];
  // `this` binding for each call. Lets users assert constructor / method binding.
  contexts: unknown[];
  // When the spy is invoked with `new`, the constructed instance. Otherwise undefined.
  instances: unknown[];
  // Convenience: same as `calls[calls.length - 1]`.
  lastCall: unknown[] | undefined;
}

export interface Spy<T extends AnyFn = AnyFn> {
  (...args: Parameters<T>): ReturnType<T>;

  // Recorded state. Reset via `mockClear()` or `mockReset()`.
  mock: MockState;

  // Tag the spy so it shows up nicely in errors. Returns `this` for chaining.
  mockName(name: string): Spy<T>;
  // Get the assigned mock name, or "spy" if none.
  getMockName(): string;

  // Set the implementation used for every subsequent call (until reset).
  mockImplementation(impl: T): Spy<T>;
  // Queue a one-shot implementation. Multiple `Once` calls form a FIFO queue.
  mockImplementationOnce(impl: T): Spy<T>;

  // Always return this value. Equivalent to `mockImplementation(() => v)`.
  mockReturnValue(value: ReturnType<T>): Spy<T>;
  // Return this value once, then fall back to the next strategy.
  mockReturnValueOnce(value: ReturnType<T>): Spy<T>;

  // Always return `Promise.resolve(value)`.
  mockResolvedValue(value: Awaited<ReturnType<T>>): Spy<T>;
  // Resolve once with this value, then fall back.
  mockResolvedValueOnce(value: Awaited<ReturnType<T>>): Spy<T>;

  // Always return `Promise.reject(error)`.
  mockRejectedValue(error: unknown): Spy<T>;
  // Reject once with this error, then fall back.
  mockRejectedValueOnce(error: unknown): Spy<T>;

  // Clear `mock.calls`, `mock.results`, etc. Implementation is preserved.
  mockClear(): Spy<T>;
  // Clear state AND remove all configured implementations (revert to original / no-op).
  mockReset(): Spy<T>;
  // For `spyOn` only: restore the original method on the host object.
  mockRestore(): void;

  readonly [SPY_BRAND]: true;
}

/**
 * Internal registries. Used by `mock.clearAll()`, `mock.resetAll()`,
 * and `mock.restoreAll()` to operate on every spy created so far.
 */
export const activeSpies = new Set<Spy>();
export const activeRestorers = new Set<() => void>();

/**
 * Returns true if the value is a spy created by `spy()` or `spyOn()`.
 * Used by mock matchers to validate their `received` argument.
 */
export function isSpy(value: unknown): value is Spy {
  return (
    typeof value === "function" &&
    (value as { [SPY_BRAND]?: true })[SPY_BRAND] === true
  );
}

/**
 * True if `fn` can be used with `new` / `Reflect.construct`. Arrow functions,
 * object/class methods, async and generator functions, and most bound
 * functions are NOT constructable.
 *
 * Probes by using `fn` as the `newTarget` of a no-op construct - this
 * validates constructability without ever invoking `fn`'s body.
 */
function isConstructor(fn: AnyFn): boolean {
  try {
    Reflect.construct(function () {}, [], fn);
    return true;
  } catch {
    return false;
  }
}

interface SpyInternalConfig {
  // Original method when constructed via spyOn - used as fallback impl + on restore.
  originalImpl?: AnyFn;
  // Per-spy restore hook (runs on mockRestore). spyOn sets this; bare spy() does not.
  restoreFn?: () => void;
  // Default impl provided to spy(impl?). Used when no override is configured.
  initialImpl?: AnyFn;
}

function createSpy<T extends AnyFn>(config: SpyInternalConfig): Spy<T> {
  let mockName = "spy";
  let currentImpl: AnyFn | undefined = config.initialImpl;
  const onceImpls: AnyFn[] = [];

  const state: MockState = {
    calls: [],
    results: [],
    contexts: [],
    instances: [],
    lastCall: undefined,
  };

  // The callable. Defined as a regular `function` (not arrow) so it has its own
  // `this` binding when invoked as a method, and so `new spy(...)` works.
  function spyImpl(this: unknown, ...args: unknown[]): unknown {
    state.calls.push(args);
    state.contexts.push(this);
    state.lastCall = args;

    /**
     * Resolution order:
     *   1. queued one-shot implementations (FIFO)
     *   2. current permanent implementation
     *   3. original (spyOn) implementation
     *   4. no-op returning undefined
     */
    const impl = onceImpls.shift() ?? currentImpl ?? config.originalImpl;

    let isNewTarget = false;
    try {
      /**
       * `new.target` would be cleaner, but inside this regular function we
       * detect construction by checking whether `this` is an instance whose
       * prototype matches the spy's prototype.
       */
      isNewTarget =
        new.target !== undefined ||
        (this !== undefined &&
          this !== null &&
          Object.getPrototypeOf(this) === (spyImpl as AnyFn).prototype);
    } catch {
      isNewTarget = false;
    }

    try {
      let value: unknown;

      if (isNewTarget) {
        // `new spy()` is always valid, regardless of the implementation.
        if (impl && isConstructor(impl)) {
          // Constructable impl: run it as the constructor with the spy's
          // prototype (via newTarget), yielding its own instance.
          value = Reflect.construct(impl, args, spyImpl as unknown as AnyFn);
        } else if (impl) {
          // Non-constructable impl (arrow, method, async, …): can't
          // Reflect.construct it. Run it against the object JS already created
          // for us; the instance is that object, unless the impl explicitly
          // returns one (constructor return semantics).
          const ret = impl.apply(this, args);
          value = typeof ret === "object" && ret !== null ? ret : this;
        } else {
          // No impl: the instance is the object JS created for `new spy()`.
          value = this;
        }
        state.instances.push(value);
      } else {
        value = impl ? impl.apply(this, args) : undefined;
      }

      state.results.push({ type: "return", value });
      return value;
    } catch (err) {
      state.results.push({ type: "throw", value: err });
      throw err;
    }
  }

  // Attach state + methods.
  const spy = spyImpl as unknown as Spy<T>;

  Object.defineProperty(spy, SPY_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(spy, "mock", {
    value: state,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  spy.mockName = (name: string) => {
    mockName = name;
    return spy;
  };
  spy.getMockName = () => mockName;

  spy.mockImplementation = (impl: AnyFn) => {
    currentImpl = impl;
    return spy;
  };
  spy.mockImplementationOnce = (impl: AnyFn) => {
    onceImpls.push(impl);
    return spy;
  };

  spy.mockReturnValue = (value: unknown) =>
    spy.mockImplementation((() => value) as T);
  spy.mockReturnValueOnce = (value: unknown) =>
    spy.mockImplementationOnce((() => value) as T);

  spy.mockResolvedValue = (value: unknown) =>
    spy.mockImplementation((() => Promise.resolve(value)) as T);
  spy.mockResolvedValueOnce = (value: unknown) =>
    spy.mockImplementationOnce((() => Promise.resolve(value)) as T);

  spy.mockRejectedValue = (error: unknown) =>
    spy.mockImplementation((() => Promise.reject(error)) as T);
  spy.mockRejectedValueOnce = (error: unknown) =>
    spy.mockImplementationOnce((() => Promise.reject(error)) as T);

  spy.mockClear = () => {
    state.calls.length = 0;
    state.results.length = 0;
    state.contexts.length = 0;
    state.instances.length = 0;
    state.lastCall = undefined;
    return spy;
  };

  spy.mockReset = () => {
    spy.mockClear();
    currentImpl = undefined;
    onceImpls.length = 0;
    return spy;
  };

  spy.mockRestore = () => {
    spy.mockReset();
    if (config.restoreFn) {
      config.restoreFn();
      activeRestorers.delete(config.restoreFn);
    }
    activeSpies.delete(spy);
  };

  activeSpies.add(spy);
  return spy;
}

/**
 * Creates a standalone spy / mock function. Records every invocation and
 * supports configurable behavior via `.mockReturnValue`, `.mockImplementation`, etc.
 */
export function spy<T extends AnyFn = AnyFn>(impl?: T): Spy<T> {
  return createSpy<T>({ initialImpl: impl });
}

/**
 * Walks the prototype chain to find the descriptor for `key` - needed
 * because accessor properties (getter/setter) usually live on a prototype,
 * not on the instance itself.
 */
function findDescriptor(
  obj: object,
  key: string | symbol,
): { host: object; descriptor: PropertyDescriptor } | undefined {
  let current: object | null = obj;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return { host: current, descriptor };
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

/**
 * Replaces `obj[key]` with a spy that wraps the original method. Calling
 * `.mockRestore()` (or `mock.restoreAll()`) puts the original back.
 *
 * The original is the default implementation - calls pass through unless
 * the user provides an override via `.mockReturnValue` / `.mockImplementation`.
 *
 * The 3-arg form `spyOn(obj, "prop", "get")` / `spyOn(obj, "prop", "set")`
 * wraps the accessor instead of a method. Setter spies record the assigned
 * value as the first call argument; getter spies record the returned value
 * in `mock.results`.
 */
export function spyOn<T extends object, K extends keyof T & (string | symbol)>(
  obj: T,
  key: K,
): T[K] extends AnyFn ? Spy<T[K]> : never;
export function spyOn<T extends object, K extends keyof T & (string | symbol)>(
  obj: T,
  key: K,
  accessor: "get",
): Spy<() => T[K]>;
export function spyOn<T extends object, K extends keyof T & (string | symbol)>(
  obj: T,
  key: K,
  accessor: "set",
): Spy<(value: T[K]) => void>;
export function spyOn<T extends object, K extends keyof T & (string | symbol)>(
  obj: T,
  key: K,
  accessor?: "get" | "set",
): Spy {
  // Accessor (getter/setter) path - 3-arg form.
  if (accessor === "get" || accessor === "set") {
    const found = findDescriptor(obj, key);
    if (!found) {
      throw new Error(
        `spyOn() could not find property "${String(key)}" on the target or its prototype chain`,
      );
    }
    const { host, descriptor } = found;
    const original = descriptor[accessor];

    // Repeat spyOn on an already-spied accessor returns the existing spy.
    // Wrapping a spy in a spy would capture the first spy as the "original",
    // and restoring would then put the first spy back instead of the real
    // accessor - leaking a mock past restoreAll().
    if (isSpy(original)) {
      return original;
    }

    if (descriptor.configurable === false) {
      throw new Error(
        `spyOn() cannot wrap non-configurable property "${String(key)}"`,
      );
    }
    if (typeof original !== "function") {
      throw new Error(
        `spyOn(..., "${accessor}") requires "${String(key)}" to have a ${accessor}ter`,
      );
    }

    // If the spy is on a prototype, restoring needs to put back the
    // *prototype's* descriptor at the *prototype* level - not on `obj`.
    // Idempotent: a second run (mockRestore + restoreAll) is a no-op.
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      Object.defineProperty(host, key, descriptor);
    };

    const accessorSpy = createSpy({
      originalImpl: original as AnyFn,
      restoreFn: restore,
    });

    const newDescriptor: PropertyDescriptor = {
      configurable: true,
      enumerable: descriptor.enumerable,
      [accessor]: accessorSpy,
    };
    // Preserve the other half of the pair (the unspied accessor stays put).
    if (accessor === "get" && descriptor.set)
      newDescriptor.set = descriptor.set;
    if (accessor === "set" && descriptor.get)
      newDescriptor.get = descriptor.get;

    Object.defineProperty(host, key, newDescriptor);
    activeRestorers.add(restore);

    return accessorSpy as Spy;
  }

  // Method path - original 2-arg behavior.
  const original = obj[key];

  // Repeat spyOn on an already-spied method returns the existing spy rather
  // than wrapping it. A spy-wrapping-a-spy would capture the first spy as its
  // "original", so restore order could put the first spy back after the real
  // method - leaking a mock past restoreAll().
  if (isSpy(original)) {
    return original;
  }

  if (typeof original !== "function") {
    throw new Error(
      `spyOn() requires a function property; got ${typeof original} for key "${String(key)}"`,
    );
  }

  const descriptor = Object.getOwnPropertyDescriptor(obj, key);

  if (descriptor && descriptor.configurable === false) {
    throw new Error(
      `spyOn() cannot wrap non-configurable property "${String(key)}"`,
    );
  }

  // Idempotent: mockRestore() followed by restoreAll() must not re-apply.
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (descriptor) {
      Object.defineProperty(obj, key, descriptor);
    } else {
      delete obj[key];
    }
  };

  const spy = createSpy({
    originalImpl: original as AnyFn,
    restoreFn: restore,
  });

  Object.defineProperty(obj, key, {
    value: spy,
    writable: true,
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
  });

  activeRestorers.add(restore);

  return spy as Spy;
}

// Clear call history on every active spy. Implementations are preserved.
export function clearAllMocks(): void {
  for (const spy of activeSpies) spy.mockClear();
}

// Clear call history AND remove all configured implementations on every active spy.
export function resetAllMocks(): void {
  for (const spy of activeSpies) spy.mockReset();
}

// Restore originals for every spyOn / stub created so far, then clear all spy state.
export function restoreAllMocks(): void {
  // Iterate over a snapshot - restorers mutate the set as they run.
  for (const restore of [...activeRestorers]) {
    restore();
    activeRestorers.delete(restore);
  }
  for (const spy of [...activeSpies]) spy.mockReset();
  activeSpies.clear();
}
