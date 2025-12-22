// expect.ts
import type { MatcherContext, MatcherFn, MatcherMap } from "./matchers";

const matcherRegistry: MatcherMap = Object.create(null);

export function extendMatchers(newMatchers: MatcherMap) {
  for (const key in newMatchers) matcherRegistry[key] = newMatchers[key];
}

export interface Matchers<T> {
  toBe(expected: T): void | Promise<void>;
  toEqual(expected: unknown): void | Promise<void>;
  toStrictEqual(expected: unknown): void | Promise<void>;
  toThrow(expected?: unknown): void | Promise<void>;
  readonly not: Matchers<T>;
}

// export interface Matchers<T> {} // for declaration merging

interface ExpectInterface {
  <T>(value: T): Matchers<T>;
  extend<M extends MatcherMap>(m: M): void;
}

export const expect: ExpectInterface = (() => {
  function expectFn<T>(received: T): Matchers<T> {
    function makeExpectation(isNot: boolean): Matchers<T> {
      const ctx: MatcherContext = {
        isNot,
        diff(received, expected) {
          return (
            "\n  Received: " +
            JSON.stringify(received, null, 2) +
            "\n  Expected: " +
            JSON.stringify(expected, null, 2)
          );
        },
      };

      const handler: Record<string, unknown> = {};
      for (const name in matcherRegistry) {
        const fn = matcherRegistry[name] as MatcherFn<T>;

        handler[name] = (...args: unknown[]) =>
          fn.call(ctx, received, ...(args as []));
      }

      return new Proxy(handler as unknown as Matchers<T>, {
        get(target, prop) {
          if (prop === "not") return makeExpectation(!isNot);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = (target as any)[prop];

          if (value === undefined && typeof prop === "string") {
            throw new Error(`Unknown matcher: ${prop}`);
          }

          return value;
        },
      });
    }

    return makeExpectation(false);
  }

  (expectFn as ExpectInterface).extend = extendMatchers;

  return expectFn as ExpectInterface;
})();

// optional debug surface
Object.defineProperty(expect, "matchers", {
  get() {
    return matcherRegistry;
  },
});
