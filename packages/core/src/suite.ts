import { unriftGlobalContext } from "./context";
import { resetMatchers } from "./matchers";
import { Test } from "./test";

import { type PromisableFn, TaskMode, TaskStatus } from "./types";
import { toError } from "./utils/toError";

interface RunOptions {
  timeoutMs?: number;
  bail?: boolean;
}

interface SuiteRunState {
  bailed: boolean;
}

function appendHookFailure(
  existing: Error | undefined,
  hookName: string,
  hookError: Error,
): Error {
  if (!existing) return hookError;

  const primaryMsg = existing.message || String(existing);
  const hookMsg = hookError.message || String(hookError);

  const combined = new Error(`${primaryMsg}\n\n[${hookName}] ${hookMsg}`);

  const primaryStack = existing.stack ?? primaryMsg;
  const hookStack = hookError.stack ?? hookMsg;

  combined.stack = `${primaryStack}\n\n[${hookName}] ${hookStack}`;

  return combined;
}

export class Suite {
  description: string;
  mode: TaskMode;
  parent?: Suite;

  subtreeHasOnly: boolean = false;

  root: boolean = false;
  errors: Array<{ label: string; error: Error }> = [];
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
    mode: TaskMode = TaskMode.Default,
  ) {
    this.description = description;
    this.parent = parent;
    this.mode = mode;
  }

  public markSubtreeSkipped() {
    for (const test of this.tests) {
      if (test.status === TaskStatus.Pending) test.status = TaskStatus.Skipped;
      test.durationMs = 0;
    }

    for (const suite of this.suites) suite.markSubtreeSkipped();
  }

  public markSubtreeTodo() {
    for (const test of this.tests) {
      if (test.status === TaskStatus.Pending) test.status = TaskStatus.Todo;
      test.durationMs = 0;
    }

    for (const suite of this.suites) suite.markSubtreeTodo();
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
    state: SuiteRunState = { bailed: false },
    isOnly: boolean = false,
    ancestorOnly: boolean = false,
  ): Promise<void> {
    // Bail should mark anything not-run as skipped (no "pending" leaks).
    if (state.bailed) {
      this.markSubtreeSkipped();

      return;
    }

    if (this.mode === TaskMode.Skip) {
      this.markSubtreeSkipped();

      return;
    }

    if (this.mode === TaskMode.Todo) {
      this.markSubtreeTodo();

      return;
    }

    const suiteHasOnly = this.subtreeHasOnly;
    const inOnlyContext = ancestorOnly || this.mode === TaskMode.Only;

    // If only is on and this suite has no runnable-only content, skip it entirely
    if (isOnly && !suiteHasOnly && !inOnlyContext) {
      this.markSubtreeSkipped();

      return;
    }

    let entered = false;

    try {
      // beforeAll
      try {
        for (const hook of this.beforeAllHooks) {
          await hook();
        }
      } catch (error) {
        this.beforeAllError = toError(error);

        // Prevent "pending" tests from showing up if beforeAll fails
        this.markSubtreeSkipped();
        return;
      }

      entered = true;

      const beforeEachHooks = this.collectBeforeEachHooks();
      const afterEachHooks = this.collectAfterEachHooks();

      // Indexed so we can skip remaining tests on bail
      for (let i = 0; i < this.tests.length; i++) {
        const test = this.tests[i];

        if (state.bailed) break;

        if (test.mode === TaskMode.Skip) {
          test.status = TaskStatus.Skipped;
          test.durationMs = 0;
          continue;
        }

        if (test.mode === TaskMode.Todo) {
          test.status = TaskStatus.Todo;
          test.durationMs = 0;
          continue;
        }

        const testIsOnly = inOnlyContext || test.mode === TaskMode.Only;

        // If onlyMode, skip tests that are not in only context
        if (isOnly && !testIsOnly) {
          test.status = TaskStatus.Skipped;
          test.durationMs = 0;
          continue;
        }

        try {
          for (const hook of beforeEachHooks) {
            try {
              await hook();
            } catch (error) {
              throw appendHookFailure(undefined, "beforeEach", toError(error));
            }
          }

          await test.run(options?.timeoutMs);
        } catch (error) {
          test.status = TaskStatus.Fail;
          test.error = toError(error);
        } finally {
          for (const hook of afterEachHooks) {
            try {
              await hook();
            } catch (error) {
              test.status = TaskStatus.Fail;
              test.error = appendHookFailure(
                test.error,
                "afterEach",
                toError(error),
              );
            }
          }
        }

        // Mark everything that hasn't run as skipped on bail
        if (options?.bail && test.status === TaskStatus.Fail) {
          state.bailed = true;

          // Remaining tests in this suite
          for (let j = i + 1; j < this.tests.length; j++) {
            const t = this.tests[j];
            if (t.status === TaskStatus.Pending) t.status = TaskStatus.Skipped;
            t.durationMs = 0;
          }

          // All child suites won't run
          for (const child of this.suites) child.markSubtreeSkipped();

          break;
        }
      }

      // Indexed so we can skip remaining suites on bail
      for (let i = 0; i < this.suites.length; i++) {
        const childSuite = this.suites[i];

        if (state.bailed) {
          // Current and remaining suites won't run
          for (let j = i; j < this.suites.length; j++) {
            this.suites[j].markSubtreeSkipped();
          }
          break;
        }

        await childSuite.run(options, state, isOnly, inOnlyContext);
      }
    } finally {
      // afterAll should still run for suites we entered, even on bail,
      // but it should not run for suites we haven't entered.
      if (entered) {
        for (const afterAllHook of this.afterAllHooks) {
          try {
            await afterAllHook();
          } catch (error) {
            // Record once; keep running remaining afterAll hooks
            if (!this.afterAllError) {
              this.afterAllError = toError(error);
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
    this.errors = [];
    this.subtreeHasOnly = false;
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

    for (const suiteError of this.errors) {
      results.push({
        description: `${this.getFullDescription()} > [${suiteError.label}]`,
        status: TaskStatus.Fail,
        error: suiteError.error,
        durationMs: 0,
      });
    }

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

    for (const child of this.suites) {
      results = results.concat(child.getResults());
    }

    return results;
  }
}

export function computeOnlyFlags(suite: Suite): boolean {
  // Clear any stale value first for multi-run in same process
  suite.subtreeHasOnly = false;

  let subtreeHasOnly = suite.mode === TaskMode.Only;

  for (const test of suite.tests) {
    if (test.mode === TaskMode.Only) subtreeHasOnly = true;
  }

  for (const child of suite.suites) {
    if (computeOnlyFlags(child)) subtreeHasOnly = true;
  }

  suite.subtreeHasOnly = subtreeHasOnly;

  return subtreeHasOnly;
}

// KNOWN LIMITATION: rootSuite is a global singleton. This means parallel test
// execution in the same process is not supported. A future DI/context-container
// pattern would be needed to support worker-based parallelism.
export const rootSuite = new Suite("root");
rootSuite.root = true;

export function getCurrentSuite() {
  return unriftGlobalContext.currentSuite || rootSuite;
}

export function clearContext() {
  rootSuite.reset();
  rootSuite.subtreeHasOnly = false;
  resetMatchers();
  unriftGlobalContext.currentSuite = rootSuite;
}
