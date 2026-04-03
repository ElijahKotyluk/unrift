import { expect } from "./expect";

import { deepEqual } from "./utils/deepEqual";
import { looseEqual } from "./utils/looseEqual";
import { toThrow, type ToThrowExpected } from "./utils/toThrow";

import type { MatcherContext } from "./types";

let matchersRegistered = false;

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
          : expected.test(received);

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
