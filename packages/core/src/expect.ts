import type { MatcherContext, MatcherMap } from "./types";
import { formatDiff } from "./utils/diff";

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
  toBeGreaterThan(expected: number): void | Promise<void>;
  toBeLessThan(expected: number): void | Promise<void>;
  toBeInstanceOf(expected: { prototype: unknown }): void | Promise<void>;
  toContain(expected: unknown): void | Promise<void>;
  toEqual(expected: unknown): void | Promise<void>;
  toHaveLength(expected: number): void | Promise<void>;
  toMatch(expected: RegExp | string): void | Promise<void>;
  toStrictEqual(expected: unknown): void | Promise<void>;
  toThrow(expected?: unknown): void | Promise<void>;
  toBeGreaterThanOrEqual(expected: number): void | Promise<void>;
  toBeLessThanOrEqual(expected: number): void | Promise<void>;
  toBeNaN(): void | Promise<void>;
  toBeFinite(): void | Promise<void>;
  toMatchObject(expected: Record<string, unknown>): void | Promise<void>;
  toHaveProperty(
    path: string | readonly string[],
    value?: unknown,
  ): void | Promise<void>;

  // Spy / mock matchers - `received` must be a value created by spy() or spyOn().
  toHaveBeenCalled(): void | Promise<void>;
  toHaveBeenCalledTimes(expected: number): void | Promise<void>;
  toHaveBeenCalledWith(...args: unknown[]): void | Promise<void>;
  toHaveBeenLastCalledWith(...args: unknown[]): void | Promise<void>;
  toHaveBeenNthCalledWith(n: number, ...args: unknown[]): void | Promise<void>;
  toHaveReturned(): void | Promise<void>;
  toHaveReturnedTimes(expected: number): void | Promise<void>;
  toHaveReturnedWith(expected: unknown): void | Promise<void>;
  toHaveLastReturnedWith(expected: unknown): void | Promise<void>;
  toHaveNthReturnedWith(n: number, expected: unknown): void | Promise<void>;

  // Fetch matchers - `received` must be `mock.fetch`.
  toHaveFetched(
    urlOrMatcher: string | RegExp | ((req: Request) => boolean),
  ): void | Promise<void>;
  toHaveFetchedTimes(expected: number): void | Promise<void>;

  readonly not: Matchers<T>;
  readonly resolves: Matchers<Awaited<T>>;
  readonly rejects: Matchers<unknown>;
}

// Merge point for external matcher packages
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export interface Matchers<T> {}

export interface ExpectInterface {
  <T>(value: T): Matchers<T>;
  extend<M extends MatcherMap>(m: M): void;
  readonly matchers: Readonly<MatcherMap>;
}

export const expect: ExpectInterface = (() => {
  function expectFn<T>(received: T): Matchers<T> {
    function makeExpectation(isNot: boolean): Matchers<T> {
      const ctx: MatcherContext = {
        isNot,
        diff(a, b) {
          return formatDiff(a, b);
        },
      };

      const matcherFns: Record<PropertyKey, unknown> = {};

      for (const name in matcherRegistry) {
        const fn = matcherRegistry[name];
        matcherFns[name] = (...args: unknown[]) =>
          fn.call(ctx, received, ...args);
      }

      function makeAsyncProxy(
        getActual: () => Promise<unknown>,
        asyncIsNot: boolean,
      ): Matchers<unknown> {
        const asyncCtx: MatcherContext = {
          isNot: asyncIsNot,
          diff(a, b) {
            return formatDiff(a, b);
          },
        };

        const asyncFns: Record<PropertyKey, unknown> = {};

        for (const name in matcherRegistry) {
          const fn = matcherRegistry[name];

          asyncFns[name] = async (...args: unknown[]) => {
            const actual = await getActual();
            return fn.call(asyncCtx, actual, ...args);
          };
        }

        return new Proxy(asyncFns, {
          get(target, prop) {
            if (prop === "not") {
              return makeAsyncProxy(getActual, !asyncIsNot);
            }

            if (typeof prop === "string" && !(prop in target)) {
              throw new Error(`Unknown matcher: ${prop}`);
            }

            return target[prop];
          },
        }) as unknown as Matchers<unknown>;
      }

      return new Proxy(matcherFns, {
        get(target, prop) {
          if (prop === "not") return makeExpectation(!isNot);

          if (prop === "resolves") {
            return makeAsyncProxy(async () => {
              try {
                return await (received as Promise<unknown>);
              } catch (err) {
                throw new Error(
                  `Expected promise to resolve, but it rejected with: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }, isNot);
          }

          if (prop === "rejects") {
            return makeAsyncProxy(async () => {
              try {
                await (received as Promise<unknown>);
                throw new Error("Expected promise to reject, but it resolved");
              } catch (err) {
                if (
                  err instanceof Error &&
                  err.message === "Expected promise to reject, but it resolved"
                ) {
                  throw err;
                }
                return err;
              }
            }, isNot);
          }

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
