/**
 * Auto-mocking helpers: `mock.object` and `mock.class`.
 *
 * Both walk own + prototype methods and replace each function with a spy.
 * Restoration uses the same registry as `spyOn`, so `mock.restoreAll()`
 * cleans up auto mocks too.
 */

import { spy, spyOn, type AnyFn } from "./spy";

/**
 * Walks the chain from `target` up to (but not including) the built in
 * `Object.prototype` and `Function.prototype`, yielding every own method
 * key encountered. Spying on built in prototypes (`apply`, `call`, etc.)
 * would recurse into the spy machinery itself.
 */
function* enumerableMethodKeys(
  target: object,
): Generator<{ host: object; key: string | symbol }, void, void> {
  const seen = new Set<string | symbol>();
  let current: object | null = target;

  while (
    current &&
    current !== Object.prototype &&
    current !== Function.prototype
  ) {
    for (const key of Reflect.ownKeys(current)) {
      if (seen.has(key)) continue;
      // Skip the `constructor` property, replacing it would break
      // `instance.constructor` checks and is rarely what callers want.
      if (key === "constructor") continue;
      // Built in `Function` properties on a constructor we don't want to
      // wrap (length / name are non-writable; prototype is structural).
      if (key === "length" || key === "name" || key === "prototype") continue;

      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor) continue;

      // Skip getters/setters: spyOn would invoke the getter to read the
      // current value, which can have side effects. Track separately.
      if (descriptor.get || descriptor.set) continue;
      if (typeof descriptor.value !== "function") continue;
      if (descriptor.configurable === false) continue;

      seen.add(key);
      yield { host: current, key };
    }

    current = Object.getPrototypeOf(current) as object | null;
  }
}

/**
 * Replace every method on `obj` (own + inherited, excluding Object.prototype)
 * with a spy. Returns the same reference, mutated in place.
 *
 * Cleanup happens via `mock.restoreAll()` - auto-mock spies share the same
 * restorer registry as `spyOn`.
 */
export function mockObject<T extends object>(obj: T): T {
  for (const { host, key } of enumerableMethodKeys(obj)) {
    try {
      spyOn(host as Record<string | symbol, AnyFn>, key);
    } catch {
      /** Non-configurable properties (e.g. some built ins), skip silently.
       * Test code targeting these would fail clearly when the spy methods
       * aren't found. We don't want auto mock to throw on the first such key.
       */
    }
  }

  return obj;
}

/**
 * Wrap a constructor so every instance is auto-mocked, and so static
 * methods on the constructor itself are spied too. Returns a Proxy that
 * is `instanceof`-compatible with the original.
 *
 * Instance methods are spied as OWN properties on each instance (shadowing
 * the prototype), NOT by mutating the shared prototype. This keeps call
 * state per-instance (a.run and b.run are separate spies) and leaves the
 * class prototype untouched - nothing to restore, nothing to leak.
 */
export function mockClass<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends new (...args: any[]) => any,
>(Ctor: T): T {
  // Spy static methods on the constructor itself (mutates Ctor in place;
  // statics are own properties of Ctor, so spyOn restores them normally).
  mockObject(Ctor);

  return new Proxy(Ctor, {
    construct(target, args, newTarget) {
      const instance = Reflect.construct(target, args, newTarget) as object;

      for (const { host, key } of enumerableMethodKeys(instance)) {
        if (host === instance) {
          // Own method (assigned in the constructor): spy in place.
          spyOn(instance as Record<string | symbol, AnyFn>, key);
        } else {
          // Inherited method: shadow it with an own-property spy that passes
          // through to the prototype implementation. The prototype itself is
          // never modified.
          const protoMethod = (host as Record<string | symbol, AnyFn>)[key];
          Object.defineProperty(instance, key, {
            value: spy(protoMethod),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
      }

      return instance;
    },
  });
}
