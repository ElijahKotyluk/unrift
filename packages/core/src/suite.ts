import { unriftGlobalContext } from "./context";
import { Test } from "./test";

import type { PromisableFn, TaskStatus } from "./types";

interface SuiteTask {
  description: string;
  parent?: Suite;
  suites: Suite[];
  tests: Test[];

  addSuite(suite: Suite): void;
  addTest(test: Test): void;

  run(): Promise<void>;
}

class Suite implements SuiteTask {
  description: string;
  parent?: Suite;
  root: boolean = false;
  suites: Suite[] = [];
  tests: Test[] = [];

  // hooks
  beforeAllHooks: PromisableFn<void>[] = [];
  afterAllHooks: PromisableFn<void>[] = [];
  beforeEachHooks: PromisableFn<void>[] = [];
  afterEachHooks: PromisableFn<void>[] = [];

  constructor(description: string, parent?: Suite) {
    this.description = description;
    this.parent = parent;
  }

  addSuite(suite: Suite) {
    this.suites.push(suite);
  }

  addTest(test: Test) {
    this.tests.push(test);
  }

  async run() {
    for (const hook of this.beforeAllHooks) {
      await hook();
    }

    for (const test of this.tests) {
      for (const hook of this.beforeEachHooks) {
        await hook();
      }

      await test.run();

      for (const hook of this.afterEachHooks) {
        await hook();
      }
    }

    for (const childSuite of this.suites) {
      await childSuite.run();
    }

    for (const afterAllHook of this.afterAllHooks) {
      await afterAllHook();
    }
  }

  getFullDescription(): string {
    if (this.parent && !this.parent.root) {
      return `${this.parent.getFullDescription()} -> ${this.description}`;
    }
    return this.description;
  }

  reset() {
    this.tests = [];
    this.suites = [];
    this.beforeAllHooks = [];
    this.afterAllHooks = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
  }

  getResults(): {
    description: string;
    status: TaskStatus;
    error?: Error;
    durationMs: number;
  }[] {
    let results: Array<{
      description: string;
      status: TaskStatus;
      error?: Error;
      durationMs: number;
    }> = [];

    for (const test of this.tests) {
      results.push({
        description: `${this.getFullDescription()} > ${test.description}`,
        status: test.status,
        error: test.error,
        durationMs: test.durationMs ?? 0,
      });
    }

    for (const child of this.suites)
      results = results.concat(child.getResults());
    return results;
  }
}

export const rootSuite = new Suite("root");

export function getCurrentSuite() {
  return unriftGlobalContext.currentSuite || rootSuite;
}

export function clearContext() {
  rootSuite.reset();
  unriftGlobalContext.currentSuite = rootSuite;
}

export { Suite };
