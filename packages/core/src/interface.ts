import { assertRegisterPhase, unriftGlobalContext } from "./context";
import { getCurrentSuite, Suite } from "./suite";
import { Test } from "./test";

import type { PromisableFn } from "./types";

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

function _describe(
  description: string,
  fn: () => void,
  mode: "default" | "skip" | "only",
) {
  assertRegisterPhase("describe");

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
  _describe(description, fn, "default");
describe.only = (description, fn) => _describe(description, fn, "only");
describe.skip = (description, fn) => _describe(description, fn, "skip");

function _it(
  description: string,
  fn: PromisableFn<void>,
  mode: "default" | "skip" | "only",
) {
  assertRegisterPhase("it");

  const test = new Test(description, fn, mode);

  getCurrentSuite().addTest(test);
}

const it: ItFn = (description, fn) => _it(description, fn, "default");
it.only = (description, fn) => _it(description, fn, "only");
it.skip = (description, fn) => _it(description, fn, "skip");

export { describe, it };
