import {
  MatcherContext,
  MatcherFn,
  MatcherMap,
  matcherRegistry,
} from "./matchers";

export interface ExpectInterface {
  <T>(value: T): Expectation<T>;
  extend<M extends MatcherMap>(m: M): void;
}

type Expectation<T> = {
  not: Expectation<T>;
} & {
  [K in keyof typeof matcherRegistry]: (typeof matcherRegistry)[K] extends MatcherFn<
    T,
    infer A
  >
    ? (...args: A) => ReturnType<(typeof matcherRegistry)[K]>
    : never;
};

export function extendMatchers(newMatchers: MatcherMap) {
  for (const key in newMatchers) {
    matcherRegistry[key] = newMatchers[key];
  }
}

export const expect: ExpectInterface = (() => {
  function expectFn<T>(received: T): Expectation<T> {
    function makeExpectation(isNot: boolean): Expectation<T> {
      const ctx: MatcherContext = {
        isNot,
        diff(a, b) {
          return (
            JSON.stringify(a, null, 2) + "\nvs\n" + JSON.stringify(b, null, 2)
          );
        },
      };

      const handler: Record<string, unknown> = {};

      for (const name in matcherRegistry) {
        const fn = matcherRegistry[name] as MatcherFn<T>;

        handler[name] = (...args: unknown[]) =>
          fn.call(ctx, received, ...(args as []));
      }

      return new Proxy(handler as Expectation<T>, {
        get(target, prop) {
          if (prop === "not") {
            return makeExpectation(!isNot);
          }
          return target[prop as keyof typeof target];
        },
      });
    }

    return makeExpectation(false);
  }

  (expectFn as ExpectInterface).extend = extendMatchers;

  return expectFn as ExpectInterface;
})();

expect.extend = extendMatchers;
Object.defineProperty(expect, "matchers", {
  get() {
    return matcherRegistry;
  },
});
