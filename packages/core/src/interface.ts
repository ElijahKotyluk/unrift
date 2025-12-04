import { unriftGlobalContext } from "./context";
import { getCurrentSuite, Suite } from "./suite";
import { Test } from "./test";

import type { PromisableFn } from "./types";

function _describe(description: string, fn: PromisableFn<void>) {
  const parent = getCurrentSuite();
  const suite = new Suite(description, parent);
  parent.addSuite(suite);

  unriftGlobalContext.currentSuite = suite;
  try {
    fn();
  } finally {
    unriftGlobalContext.currentSuite = parent;
  }
}

function _it(description: string, fn: PromisableFn<void>) {
  const test = new Test(description, fn);
  getCurrentSuite().addTest(test);
}

const describe = (description: string, fn: PromisableFn<void>) => {
  return _describe(description, fn);
};

const it = (description: string, fn: PromisableFn<void>) => {
  return _it(description, fn);
};

export { describe, it };
