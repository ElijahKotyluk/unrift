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

    toEqual<T>(this: MatcherContext, received: T, expected: T) {
      const pass = looseEqual(received, expected);

      if (this.isNot ? pass : !pass) {
        throw new Error(this.diff(received, expected));
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
