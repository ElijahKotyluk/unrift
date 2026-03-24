import { expect } from "./expect";

import { deepEqual } from "./utils/deepEqual";
import { looseEqual } from "./utils/looseEqual";
import { toThrow, type ToThrowExpected } from "./utils/toThrow";

import type { MatcherContext } from "./types";

let matchersRegistered = false;

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
      const obj = received as { length?: unknown };

      if (
        obj == null ||
        typeof obj !== "object" ||
        typeof obj.length !== "number"
      ) {
        throw new Error(
          this.diff(received, "expected a value with a .length property"),
        );
      }

      const pass = obj.length === (expected as number);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(obj.length, expected));
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
  });
}
