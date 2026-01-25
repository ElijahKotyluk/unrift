import { assertRegisterState, unriftGlobalContext } from "./context";
import { getCurrentSuite, Suite } from "./suite";
import { Test } from "./test";

import { type PromisableFn, TaskMode } from "./types";

/**
 * @TODO expose test and suite aliases
 */

type DescribeFn = {
  (description: string, fn: () => void): void;
  only: (description: string, fn: () => void) => void;
  skip: (description: string, fn: () => void) => void;
};

type ItFn = {
  (description: string, fn: PromisableFn<void>): void;
  only: (description: string, fn: PromisableFn<void>) => void;
  skip: (description: string, fn: PromisableFn<void>) => void;
};

function _describe(description: string, fn: () => void, mode: TaskMode) {
  assertRegisterState("describe");

  const parent = getCurrentSuite();
  const suite = new Suite(description, parent, mode);

  parent.addSuite(suite);

  unriftGlobalContext.currentSuite = suite;

  try {
    fn();
  } finally {
    unriftGlobalContext.currentSuite = parent;
  }
}

const describe: DescribeFn = (description, fn) =>
  _describe(description, fn, TaskMode.Default);
describe.only = (description, fn) => _describe(description, fn, TaskMode.Only);
describe.skip = (description, fn) => _describe(description, fn, TaskMode.Skip);

function _it(description: string, fn: PromisableFn<void>, mode: TaskMode) {
  assertRegisterState("it");

  const test = new Test(description, fn, mode);

  getCurrentSuite().addTest(test);
}

const it: ItFn = (description, fn) => _it(description, fn, TaskMode.Default);
it.only = (description, fn) => _it(description, fn, TaskMode.Only);
it.skip = (description, fn) => _it(description, fn, TaskMode.Skip);

export { describe, it };
