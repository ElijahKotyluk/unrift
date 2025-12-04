import { deepEqual } from "./utils/deepEqual";
import { extendMatchers } from "./expect";

export interface MatcherMap {
  [name: string]: MatcherFn<unknown>;
}

export const coreMatchers: MatcherMap = {};

export const matcherRegistry: MatcherMap = { ...coreMatchers };

extendMatchers({
  toBe<T>(this: MatcherContext, received: T, expected: T) {
    const pass = Object.is(received, expected);
    if (this.isNot ? pass : !pass) {
      throw new Error(
        `Expected ${received} ${this.isNot ? "not " : ""}to be ${expected}`,
      );
    }
  },

  toEqual<T>(this: MatcherContext, received: T, expected: T) {
    const pass = JSON.stringify(received) === JSON.stringify(expected);
    if (this.isNot ? pass : !pass) {
      throw new Error(`Expected:\n${this.diff(received, expected)}`);
    }
  },

  toStrictEqual<T>(this: MatcherContext, received: T, expected: T) {
    const pass = deepEqual(received, expected);
    if (this.isNot ? pass : !pass) {
      throw new Error(`Expected:\n${this.diff(received, expected)}`);
    }
  },
});

export interface MatcherContext {
  isNot: boolean;
  diff(a: unknown, b: unknown): string;
}

export type MatcherFn<T, A extends unknown[] = unknown[]> = (
  this: MatcherContext,
  received: T,
  ...args: A
) => void | Promise<void>;
