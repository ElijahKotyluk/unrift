import type { MatcherContext, MatcherMap } from "./types";

const matcherRegistry: MatcherMap = Object.create(null);

export function extendMatchers(newMatchers: MatcherMap) {
  for (const key in newMatchers) matcherRegistry[key] = newMatchers[key];
}

/**
 * Built-in matchers
 * @TODO add more matchers and extract to separate package.
 */
export interface Matchers<T> {
  toBe(expected: T): void | Promise<void>;
  toBeDefined(): void | Promise<void>;
  toBeFalsy(): void | Promise<void>;
  toBeNull(): void | Promise<void>;
  toBeTruthy(): void | Promise<void>;
  toBeUndefined(): void | Promise<void>;
  toEqual(expected: unknown): void | Promise<void>;
  toMatch(expected: RegExp | string): void | Promise<void>;
  toStrictEqual(expected: unknown): void | Promise<void>;
  toThrow(expected?: unknown): void | Promise<void>;

  readonly not: Matchers<T>;
}

// Merge point for external matcher packages
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export interface Matchers<T> {}

export interface ExpectInterface {
  <T>(value: T): Matchers<T>;
  extend<M extends MatcherMap>(m: M): void;
}

export const expect: ExpectInterface = (() => {
  function expectFn<T>(received: T): Matchers<T> {
    function makeExpectation(isNot: boolean): Matchers<T> {
      const ctx: MatcherContext = {
        isNot,
        diff(a, b) {
          return (
            "\n  Received: " +
            JSON.stringify(a, null, 2) +
            "\n  Expected: " +
            JSON.stringify(b, null, 2)
          );
        },
      };

      const matcherFns: Record<PropertyKey, unknown> = {};

      for (const name in matcherRegistry) {
        const fn = matcherRegistry[name];
        matcherFns[name] = (...args: unknown[]) =>
          fn.call(ctx, received, ...args);
      }

      return new Proxy(matcherFns, {
        get(target, prop) {
          if (prop === "not") return makeExpectation(!isNot);

          if (typeof prop === "string" && !(prop in target)) {
            throw new Error(`Unknown matcher: ${prop}`);
          }

          return target[prop];
        },
      }) as unknown as Matchers<T>;
    }

    return makeExpectation(false);
  }

  (expectFn as ExpectInterface).extend = extendMatchers;
  return expectFn as ExpectInterface;
})();

Object.defineProperty(expect, "matchers", {
  get() {
    return matcherRegistry;
  },
});
