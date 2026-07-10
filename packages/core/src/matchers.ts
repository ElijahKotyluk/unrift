import { expect } from "./expect";
import { isSpy, type Spy } from "./mock/spy";
import { isFetchMock, type MockFetch } from "./mock/fetch";

import { deepEqual } from "./utils/deepEqual";
import { looseEqual } from "./utils/looseEqual";
import { regexTest } from "./utils/helpers";
import { toThrow, type ToThrowExpected } from "./utils/toThrow";

import type { MatcherContext } from "./types";

let matchersRegistered = false;

function ensureSpy(
  received: unknown,
  matcherName: string,
): asserts received is Spy {
  if (!isSpy(received)) {
    throw new Error(
      `${matcherName}() requires a spy or mock function (created via spy() or spyOn()), ` +
        `but received ${typeof received === "object" ? Object.prototype.toString.call(received) : typeof received}`,
    );
  }
}

function ensureFetchMock(
  received: unknown,
  matcherName: string,
): asserts received is MockFetch {
  if (!isFetchMock(received)) {
    throw new Error(
      `${matcherName}() requires \`mock.fetch\` as the received value, ` +
        `but received ${typeof received === "object" ? Object.prototype.toString.call(received) : typeof received}`,
    );
  }
}

function matchesFetchTarget(req: Request, target: unknown): boolean {
  if (typeof target === "string") return req.url === target;
  if (target instanceof RegExp) return regexTest(target, req.url);
  if (typeof target === "function")
    return Boolean((target as (r: Request) => boolean)(req));
  return false;
}

function argsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!looseEqual(a[i], b[i])) return false;
  }
  return true;
}

function partialMatch(received: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return looseEqual(received, expected);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(received)) return false;
    if (received.length !== expected.length) return false;
    return expected.every((e, i) => partialMatch(received[i], e));
  }

  if (
    received === null ||
    typeof received !== "object" ||
    Array.isArray(received)
  ) {
    return false;
  }

  const recv = received as Record<string, unknown>;
  const exp = expected as Record<string, unknown>;

  for (const key of Object.keys(exp)) {
    if (!Object.hasOwn(recv, key)) return false;
    if (!partialMatch(recv[key], exp[key])) return false;
  }

  return true;
}

function getNestedValue(
  obj: unknown,
  path: string | readonly string[],
): { found: boolean; value: unknown } {
  const keys = Array.isArray(path) ? path : (path as string).split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || typeof current !== "object") {
      return { found: false, value: undefined };
    }

    const record = current as Record<string, unknown>;

    if (!Object.hasOwn(record, key)) return { found: false, value: undefined };

    current = record[key];
  }

  return { found: true, value: current };
}

export function ensureInternalMatchers() {
  if (matchersRegistered) return;

  registerCoreMatchers();

  matchersRegistered = true;
}

export function resetMatchers() {
  matchersRegistered = false;
}

function registerCoreMatchers() {
  expect.extend({
    toBe<T>(this: MatcherContext, received: T, expected: T) {
      const pass = Object.is(received, expected);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, expected));
      }
    },

    toBeDefined(this: MatcherContext, received: unknown) {
      const pass = received !== undefined;

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, "defined value"));
      }
    },

    toBeFalsy(this: MatcherContext, received: unknown) {
      const pass = !received;

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, "falsy value"));
      }
    },

    toBeTruthy(this: MatcherContext, received: unknown) {
      const pass = Boolean(received);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, "truthy value"));
      }
    },

    toBeNull(this: MatcherContext, received: unknown) {
      const pass = received === null;

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, null));
      }
    },

    toBeUndefined(this: MatcherContext, received: unknown) {
      const pass = received === undefined;

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, undefined));
      }
    },

    toBeGreaterThan(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      if (typeof received !== "number") {
        throw new Error(this.diff(received, "expected a number"));
      }

      const pass = received > (expected as number);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, `> ${expected}`));
      }
    },

    toBeLessThan(this: MatcherContext, received: unknown, expected: unknown) {
      if (typeof received !== "number") {
        throw new Error(this.diff(received, "expected a number"));
      }

      const pass = received < (expected as number);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, `< ${expected}`));
      }
    },

    toBeInstanceOf(this: MatcherContext, received: unknown, expected: unknown) {
      const ctor = expected as new (...args: unknown[]) => unknown;
      const pass = received instanceof ctor;

      if (this.isNot ? pass : !pass) {
        throw new Error(
          this.diff(
            typeof received === "object" && received
              ? (received.constructor?.name ?? typeof received)
              : typeof received,
            ctor.name,
          ),
        );
      }
    },

    toContain(this: MatcherContext, received: unknown, expected: unknown) {
      let pass: boolean;

      if (Array.isArray(received)) {
        pass = received.includes(expected);
      } else if (typeof received === "string") {
        pass = received.includes(expected as string);
      } else {
        throw new Error(
          this.diff(received, "expected an array or string for toContain()"),
        );
      }

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, expected));
      }
    },

    toEqual<T>(this: MatcherContext, received: T, expected: T) {
      const pass = looseEqual(received, expected);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, expected));
      }
    },

    toHaveLength(this: MatcherContext, received: unknown, expected: unknown) {
      const len =
        typeof received === "string"
          ? received.length
          : received != null &&
              typeof received === "object" &&
              typeof (received as { length?: unknown }).length === "number"
            ? (received as { length: number }).length
            : undefined;

      if (len === undefined) {
        throw new Error(
          this.diff(received, "expected a value with a .length property"),
        );
      }

      const pass = len === (expected as number);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(len, expected));
      }
    },

    toMatch(this: MatcherContext, received: unknown, expected: unknown) {
      if (typeof received !== "string") {
        throw new Error(
          this.diff(received, "Value must be a string to use toMatch()"),
        );
      }
      if (!(typeof expected === "string" || expected instanceof RegExp)) {
        throw new Error(
          this.diff(expected, "Expected must be a string or RegExp"),
        );
      }

      const pass =
        typeof expected === "string"
          ? received.includes(expected)
          : regexTest(expected, received);

      if (this.isNot ? pass : !pass)
        throw new Error(this.diff(received, expected));
    },

    toStrictEqual<T>(this: MatcherContext, received: T, expected: T) {
      const pass = deepEqual(received, expected);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, expected));
      }
    },

    toThrow(this: MatcherContext, received: unknown, expected?: unknown) {
      const { pass, message } = toThrow(
        received,
        expected as ToThrowExpected,
        this.isNot,
      );

      if (!pass) throw new Error(message());
    },

    toBeGreaterThanOrEqual(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      if (typeof received !== "number") {
        throw new Error(this.diff(received, "expected a number"));
      }

      const pass = received >= (expected as number);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, `>= ${expected}`));
      }
    },

    toBeLessThanOrEqual(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      if (typeof received !== "number") {
        throw new Error(this.diff(received, "expected a number"));
      }

      const pass = received <= (expected as number);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, `<= ${expected}`));
      }
    },

    toBeNaN(this: MatcherContext, received: unknown) {
      const pass = Number.isNaN(received);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, "NaN"));
      }
    },

    toBeFinite(this: MatcherContext, received: unknown) {
      const pass = Number.isFinite(received);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, "finite number"));
      }
    },

    toMatchObject(this: MatcherContext, received: unknown, expected: unknown) {
      if (
        received === null ||
        typeof received !== "object" ||
        Array.isArray(received)
      ) {
        throw new Error(
          this.diff(
            received,
            "expected a non-array object for toMatchObject()",
          ),
        );
      }

      const pass = partialMatch(received, expected);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, expected));
      }
    },

    toHaveBeenCalled(this: MatcherContext, received: unknown) {
      ensureSpy(received, "toHaveBeenCalled");

      const pass = received.mock.calls.length > 0;

      if (this.isNot ? pass : !pass) {
        throw new Error(
          this.diff(
            `${received.getMockName()} called ${received.mock.calls.length} time(s)`,
            "to have been called",
          ),
        );
      }
    },

    toHaveBeenCalledTimes(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      ensureSpy(received, "toHaveBeenCalledTimes");

      if (typeof expected !== "number" || !Number.isFinite(expected)) {
        throw new Error(
          this.diff(
            expected,
            "toHaveBeenCalledTimes() requires a finite number",
          ),
        );
      }

      const actual = received.mock.calls.length;
      const pass = actual === expected;

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(actual, expected));
      }
    },

    toHaveBeenCalledWith(
      this: MatcherContext,
      received: unknown,
      ...expectedArgs: readonly unknown[]
    ) {
      ensureSpy(received, "toHaveBeenCalledWith");

      const pass = received.mock.calls.some((call) =>
        argsEqual(call, expectedArgs),
      );

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received.mock.calls, expectedArgs));
      }
    },

    toHaveBeenLastCalledWith(
      this: MatcherContext,
      received: unknown,
      ...expectedArgs: readonly unknown[]
    ) {
      ensureSpy(received, "toHaveBeenLastCalledWith");

      const last = received.mock.lastCall;
      const pass = last !== undefined && argsEqual(last, expectedArgs);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(last ?? "no calls", expectedArgs));
      }
    },

    toHaveBeenNthCalledWith(
      this: MatcherContext,
      received: unknown,
      n: unknown,
      ...expectedArgs: readonly unknown[]
    ) {
      ensureSpy(received, "toHaveBeenNthCalledWith");

      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
        throw new Error(
          this.diff(
            n,
            "toHaveBeenNthCalledWith() requires a 1-indexed integer",
          ),
        );
      }

      const call = received.mock.calls[n - 1];
      const pass = call !== undefined && argsEqual(call, expectedArgs);

      if (this.isNot ? pass : !pass) {
        throw new Error(
          this.diff(call ?? `call #${n} not found`, expectedArgs),
        );
      }
    },

    toHaveReturned(this: MatcherContext, received: unknown) {
      ensureSpy(received, "toHaveReturned");

      const pass = received.mock.results.some((r) => r.type === "return");

      if (this.isNot ? pass : !pass) {
        throw new Error(
          this.diff(
            `${received.mock.results.length} result(s)`,
            "at least one successful return",
          ),
        );
      }
    },

    toHaveReturnedTimes(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      ensureSpy(received, "toHaveReturnedTimes");

      if (typeof expected !== "number" || !Number.isFinite(expected)) {
        throw new Error(
          this.diff(expected, "toHaveReturnedTimes() requires a finite number"),
        );
      }

      const actual = received.mock.results.filter(
        (r) => r.type === "return",
      ).length;
      const pass = actual === expected;

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(actual, expected));
      }
    },

    toHaveReturnedWith(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      ensureSpy(received, "toHaveReturnedWith");

      const pass = received.mock.results.some(
        (r) => r.type === "return" && looseEqual(r.value, expected),
      );

      if (this.isNot ? pass : !pass) {
        const returnValues = received.mock.results
          .filter((r) => r.type === "return")
          .map((r) => r.value);
        throw new Error(this.diff(returnValues, expected));
      }
    },

    toHaveLastReturnedWith(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      ensureSpy(received, "toHaveLastReturnedWith");

      const results = received.mock.results;
      const last = results[results.length - 1];
      const pass =
        last !== undefined &&
        last.type === "return" &&
        looseEqual(last.value, expected);

      if (this.isNot ? pass : !pass) {
        if (last === undefined) {
          throw new Error(this.diff("no calls", expected));
        }
        if (last.type === "throw") {
          throw new Error(this.diff("last call threw", expected));
        }
        throw new Error(this.diff(last.value, expected));
      }
    },

    toHaveNthReturnedWith(
      this: MatcherContext,
      received: unknown,
      n: unknown,
      expected: unknown,
    ) {
      ensureSpy(received, "toHaveNthReturnedWith");

      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
        throw new Error(
          this.diff(n, "toHaveNthReturnedWith() requires a 1-indexed integer"),
        );
      }

      const result = received.mock.results[n - 1];
      const pass =
        result !== undefined &&
        result.type === "return" &&
        looseEqual(result.value, expected);

      if (this.isNot ? pass : !pass) {
        if (result === undefined) {
          throw new Error(this.diff(`call #${n} not found`, expected));
        }
        if (result.type === "throw") {
          throw new Error(this.diff(`call #${n} threw`, expected));
        }
        throw new Error(this.diff(result.value, expected));
      }
    },

    toHaveFetched(this: MatcherContext, received: unknown, target: unknown) {
      ensureFetchMock(received, "toHaveFetched");

      const pass = received.calls.some((req) =>
        matchesFetchTarget(req, target),
      );

      if (this.isNot ? pass : !pass) {
        const urls = received.calls.map((r) => `${r.method} ${r.url}`);
        throw new Error(this.diff(urls, target));
      }
    },

    toHaveFetchedTimes(
      this: MatcherContext,
      received: unknown,
      expected: unknown,
    ) {
      ensureFetchMock(received, "toHaveFetchedTimes");

      if (typeof expected !== "number" || !Number.isFinite(expected)) {
        throw new Error(
          this.diff(expected, "toHaveFetchedTimes() requires a finite number"),
        );
      }

      const actual = received.calls.length;
      const pass = actual === expected;

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(actual, expected));
      }
    },

    toHaveProperty(
      this: MatcherContext,
      received: unknown,
      path: unknown,
      ...rest: readonly unknown[]
    ) {
      if (received === null || typeof received !== "object") {
        throw new Error(
          this.diff(received, "expected an object for toHaveProperty()"),
        );
      }

      const normalizedPath = path as string | readonly string[];
      const { found, value } = getNestedValue(received, normalizedPath);
      const hasValue = rest.length > 0;
      const expectedValue = rest[0];

      const pass = hasValue ? found && looseEqual(value, expectedValue) : found;

      if (this.isNot ? pass : !pass) {
        const pathStr = Array.isArray(normalizedPath)
          ? normalizedPath.join(".")
          : normalizedPath;

        if (!found) {
          throw new Error(
            this.diff(
              Object.keys(received as Record<string, unknown>),
              `property "${pathStr}"`,
            ),
          );
        }

        throw new Error(this.diff(value, expectedValue));
      }
    },
  });
}
