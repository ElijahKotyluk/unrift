import { unriftGlobalContext } from "./context";
import { Test } from "./test";

import { type PromisableFn, TaskStatus } from "./types";

interface RunOptions {
  timeoutMs?: number;
  bail?: boolean;
}

interface RunState {
  bailed: boolean;
}

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
  mode: "default" | "skip" | "only";
  parent?: Suite;

  hasOnly: boolean = false;
  hasOnlyDescendant: boolean = false;

  root: boolean = false;
  suites: Suite[] = [];
  tests: Test[] = [];

  afterAllError?: Error;
  beforeAllError?: Error;

  beforeAllHooks: PromisableFn<void>[] = [];
  afterAllHooks: PromisableFn<void>[] = [];
  beforeEachHooks: PromisableFn<void>[] = [];
  afterEachHooks: PromisableFn<void>[] = [];

  constructor(
    description: string,
    parent?: Suite,
    mode: "default" | "skip" | "only" = "default",
  ) {
    this.description = description;
    this.parent = parent;
    this.mode = mode;
  }

  containsOnly(): boolean {
    if (this.mode === "only") return true;
    for (const test of this.tests) if (test.mode === "only") return true;
    for (const suite of this.suites) if (suite.containsOnly()) return true;

    return false;
  }

  private markSubtreeSkipped() {
    for (const test of this.tests) {
      if (test.status === TaskStatus.Pending) test.status = TaskStatus.Skipped;
      test.durationMs = 0;
    }

    for (const suite of this.suites) suite.markSubtreeSkipped();
  }

  addSuite(suite: Suite) {
    this.suites.push(suite);
  }

  addTest(test: Test) {
    this.tests.push(test);
  }

  private collectBeforeEachHooks(): PromisableFn<void>[] {
    const beforeEachHooks: Array<PromisableFn<void>> = [];
    let currentSuite: Suite | undefined = this;
    const stack: Array<Suite> = [];

    while (currentSuite) {
      stack.push(currentSuite);
      currentSuite = currentSuite.parent;
    }

    for (let i = stack.length - 1; i >= 0; i--) {
      beforeEachHooks.push(...stack[i].beforeEachHooks);
    }

    return beforeEachHooks;
  }

  private collectAfterEachHooks(): PromisableFn<void>[] {
    const afterEachHooks: PromisableFn<void>[] = [];
    let currentSuite: Suite | undefined = this;

    while (currentSuite) {
      afterEachHooks.push(...currentSuite.afterEachHooks);
      currentSuite = currentSuite.parent;
    }

    return afterEachHooks;
  }

  async run(
    options?: RunOptions,
    state: RunState = { bailed: false },
    isOnly: boolean = false,
    ancestorOnly: boolean = false,
  ): Promise<void> {
    if (state.bailed) return;

    if (this.mode === "skip") {
      this.markSubtreeSkipped();
      return;
    }

    const suiteHasOnly = this.hasOnlyDescendant;
    const inOnlyContext = ancestorOnly || this.hasOnly;

    // If onlyMode is on and this suite has no runnable-only content, skip it entirely
    if (isOnly && !suiteHasOnly && !inOnlyContext) {
      this.markSubtreeSkipped();
      return;
    }

    let entered = false;

    try {
      try {
        for (const hook of this.beforeAllHooks) {
          await hook();
        }
      } catch (error) {
        this.beforeAllError =
          error instanceof Error ? error : new Error(String(error));

        // Prevent "pending" tests: everything under this suite didn't run
        this.markSubtreeSkipped();
        return;
      }

      entered = true;

      const beforeEachHooks = this.collectBeforeEachHooks();
      const afterEachHooks = this.collectAfterEachHooks();

      for (const test of this.tests) {
        if (state.bailed) break;

        if (test.mode === "skip") {
          test.status = TaskStatus.Skipped;
          test.durationMs = 0;
          continue;
        }

        const testIsOnly = inOnlyContext || test.hasOnly;

        // If onlyMode, skip tests that are not in only context
        if (isOnly && !testIsOnly) {
          test.status = TaskStatus.Skipped;
          test.durationMs = 0;
          continue;
        }

        try {
          for (const hook of beforeEachHooks) {
            await hook();
          }

          await test.run(options?.timeoutMs);
        } catch (error) {
          test.status = TaskStatus.Fail;
          test.error =
            error instanceof Error ? error : new Error(String(error));
        } finally {
          for (const hook of afterEachHooks) {
            try {
              await hook();
            } catch (error) {
              // If an afterEach hook fails, mark the test as failed
              test.status = TaskStatus.Fail;
              test.error =
                error instanceof Error ? error : new Error(String(error));
            }
          }
        }

        if (options?.bail && test.status === TaskStatus.Fail) {
          state.bailed = true;
          break;
        }
      }

      for (const childSuite of this.suites) {
        if (state.bailed) break;

        await childSuite.run(options, state, isOnly, inOnlyContext);
      }
    } finally {
      if (entered) {
        for (const afterAllHook of this.afterAllHooks) {
          try {
            await afterAllHook();
          } catch (error) {
            // Record once; keep running remaining afterAll hooks
            if (!this.afterAllError) {
              this.afterAllError =
                error instanceof Error ? error : new Error(String(error));
            }
          }
        }
      }
    }
  }

  getFullDescription(): string {
    if (!this.parent || this.parent.root) return this.description;

    return `${this.parent.getFullDescription()} › ${this.description}`;
  }

  reset() {
    this.tests = [];
    this.suites = [];
    this.beforeAllHooks = [];
    this.afterAllHooks = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
    this.afterAllError = undefined;
    this.beforeAllError = undefined;
  }

  getResults(): Array<{
    description: string;
    status: TaskStatus;
    error?: Error;
    durationMs: number;
  }> {
    let results: Array<{
      description: string;
      status: TaskStatus;
      error?: Error;
      durationMs: number;
    }> = [];

    if (this.beforeAllError) {
      results.push({
        description: `${this.getFullDescription()} > [beforeAll]`,
        status: TaskStatus.Fail,
        error: this.beforeAllError,
        durationMs: 0,
      });
    }

    if (this.afterAllError) {
      results.push({
        description: `${this.getFullDescription()} > [afterAll]`,
        status: TaskStatus.Fail,
        error: this.afterAllError,
        durationMs: 0,
      });
    }

    for (const test of this.tests) {
      results.push({
        description: `${this.getFullDescription()} › ${test.description}`,
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

export function computeOnlyFlags(suite: Suite): boolean {
  let subtreeHasOnly = suite.mode === "only";

  for (const test of suite.tests) {
    test.hasOnly = test.mode === "only";
    if (test.hasOnly) subtreeHasOnly = true;
  }

  for (const child of suite.suites) {
    if (computeOnlyFlags(child)) subtreeHasOnly = true;
  }

  suite.hasOnly = suite.mode === "only";
  suite.hasOnlyDescendant = subtreeHasOnly;

  return subtreeHasOnly;
}

export const rootSuite = new Suite("root");
rootSuite.root = true;

export function getCurrentSuite() {
  return unriftGlobalContext.currentSuite || rootSuite;
}

export function clearContext() {
  rootSuite.reset();
  unriftGlobalContext.currentSuite = rootSuite;
}

export { Suite };
