// @es
import { deepEqual } from "./utils/deepEqual";
import { expect } from "./expect";
import { toThrow } from "./utils/toThrow";
import { looseEqual } from "./utils/looseEqual";
// (later: import looseEqual)

export type MatcherMap = Record<string, MatcherFn<unknown, unknown[]>>;

export interface MatcherContext {
  isNot: boolean;
  diff(a: unknown, b: unknown): string;
}

export type MatcherFn<T, A extends unknown[] = unknown[]> = (
  this: MatcherContext,
  received: T,
  ...args: A
) => void | Promise<void>;

expect.extend({
  toBe<T>(this: MatcherContext, received: T, expected: T) {
    const pass = Object.is(received, expected);
    if (this.isNot ? pass : !pass) {
      throw new Error(`${this.diff(received, expected)}`);
    }
  },

  toEqual<T>(this: MatcherContext, received: T, expected: T) {
    const pass = looseEqual(received, expected);
    if (this.isNot ? pass : !pass) {
      throw new Error(`${this.diff(received, expected)}`);
    }
  },

  toStrictEqual<T>(this: MatcherContext, received: T, expected: T) {
    const pass = deepEqual(received, expected);
    if (this.isNot ? pass : !pass) {
      throw new Error(`${this.diff(received, expected)}`);
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toThrow(this: MatcherContext, received: unknown, expected?: any) {
    const { pass, message } = toThrow(received, expected, this.isNot);
    if (!pass) throw new Error(message());
  },
});
