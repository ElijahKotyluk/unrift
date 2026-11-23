import { assertRegisterState, unriftGlobalContext } from "./context";
import { getCurrentSuite, Suite } from "./suite";
import { Test } from "./test";

import { type PromisableFn, TaskMode } from "./types";
import { assertValidRetries } from "./utils/helpers";

/**
 * @TODO expose test and suite aliases
 */

type DescribeFn = {
  (description: string, fn: () => void): void;
  only: (description: string, fn: () => void) => void;
  skip: (description: string, fn: () => void) => void;
  todo: (description: string) => void;
};

export interface TestOptions {
  timeout?: number;
  retries?: number;
}

type ItFn = {
  (
    description: string,
    fn: PromisableFn<void>,
    options?: number | TestOptions,
  ): void;
  only: (
    description: string,
    fn: PromisableFn<void>,
    options?: number | TestOptions,
  ) => void;
  skip: (
    description: string,
    fn: PromisableFn<void>,
    options?: number | TestOptions,
  ) => void;
  todo: (description: string) => void;
};

function _describe(description: string, fn: () => void, mode: TaskMode) {
  assertRegisterState("describe");

  const parent = getCurrentSuite();
  const suite = new Suite(description, parent, mode);
  // Put back as it was: an abandoned file's parent isn't the run's
  const previous = unriftGlobalContext.currentSuite;

  parent.addSuite(suite);

  unriftGlobalContext.currentSuite = suite;

  try {
    const result = fn();

    if (
      result != null &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      throw new Error(
        `describe() callbacks must be synchronous. ` +
          `Move async setup into beforeAll() or beforeEach().`,
      );
    }
  } finally {
    unriftGlobalContext.currentSuite = previous;
  }
}

const describe: DescribeFn = (description, fn) =>
  _describe(description, fn, TaskMode.Default);
describe.only = (description, fn) => _describe(description, fn, TaskMode.Only);
describe.skip = (description, fn) => _describe(description, fn, TaskMode.Skip);
describe.todo = (description) =>
  _describe(description, () => {}, TaskMode.Todo);

function _it(
  description: string,
  fn: PromisableFn<void>,
  mode: TaskMode,
  options?: number | TestOptions,
) {
  assertRegisterState("it");

  // A bare number is the timeout, kept for backwards compatibility.
  const { timeout, retries } =
    typeof options === "number" ? { timeout: options } : (options ?? {});

  assertValidRetries(retries, `it("${description}")`);

  const test = new Test(description, fn, mode, timeout, retries);

  getCurrentSuite().addTest(test);
}

const it: ItFn = (description, fn, options) =>
  _it(description, fn, TaskMode.Default, options);
it.only = (description, fn, options) =>
  _it(description, fn, TaskMode.Only, options);
it.skip = (description, fn, options) =>
  _it(description, fn, TaskMode.Skip, options);
it.todo = (description) => _it(description, () => {}, TaskMode.Todo);

const test: ItFn = it;

export { describe, it, test };
