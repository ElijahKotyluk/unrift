import { unriftGlobalContext } from "./context";
import { Test } from "./test";

import { type PromisableFn, TaskMode, TaskStatus } from "./types";

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

class Suite implements SuiteTask {
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
    // Bail should mark anything not-run as skipped (no "pending" leaks).
    if (state.bailed) {
      this.markSubtreeSkipped();
      return;
    }

    if (this.mode === TaskMode.Skip) {
      this.markSubtreeSkipped();
      return;
    }

    const suiteHasOnly = this.subtreeHasOnly;
    const inOnlyContext = ancestorOnly || this.mode === TaskMode.Only;

    // If onlyMode is on and this suite has no runnable-only content, skip it entirely
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
        this.beforeAllError =
          error instanceof Error ? error : new Error(String(error));

        // Prevent "pending" tests: everything under this suite didn't run
        this.markSubtreeSkipped();
        return;
      }

      entered = true;

      const beforeEachHooks = this.collectBeforeEachHooks();
      const afterEachHooks = this.collectAfterEachHooks();

      // TEST LOOP (indexed so we can skip the remainder on bail)
      for (let i = 0; i < this.tests.length; i++) {
        const test = this.tests[i];

        if (state.bailed) break;

        if (test.mode === TaskMode.Skip) {
          test.status = TaskStatus.Skipped;
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
              const hookError =
                error instanceof Error ? error : new Error(String(error));
              throw appendHookFailure(undefined, "beforeEach", hookError);
            }
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
              const hookError =
                error instanceof Error ? error : new Error(String(error));

              test.status = TaskStatus.Fail;
              test.error = appendHookFailure(
                test.error,
                "afterEach",
                hookError,
              );
            }
          }
        }

        // Bail: mark everything not-run as skipped (no pending)
        if (options?.bail && test.status === TaskStatus.Fail) {
          state.bailed = true;

          // Remaining tests in THIS suite
          for (let j = i + 1; j < this.tests.length; j++) {
            const t = this.tests[j];
            if (t.status === TaskStatus.Pending) t.status = TaskStatus.Skipped;
            t.durationMs = 0;
          }

          // All child suites under THIS suite won't run
          for (const child of this.suites) child.markSubtreeSkipped();

          break;
        }
      }

      // CHILD SUITE LOOP (indexed so we can skip remaining siblings on bail)
      for (let i = 0; i < this.suites.length; i++) {
        const childSuite = this.suites[i];

        if (state.bailed) {
          // Current and remaining sibling suites won't run
          for (let j = i; j < this.suites.length; j++) {
            this.suites[j].markSubtreeSkipped();
          }
          break;
        }

        await childSuite.run(options, state, isOnly, inOnlyContext);
      }
    } finally {
      // afterAll should still run for suites we entered (even if bailed),
      // but it should not run for suites we never entered.
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
  // Clear any stale value first (important for multi-run in same process)
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

export const rootSuite = new Suite("root");
rootSuite.root = true;

export function getCurrentSuite() {
  return unriftGlobalContext.currentSuite || rootSuite;
}

export function clearContext() {
  rootSuite.reset();
  rootSuite.subtreeHasOnly = false;
  unriftGlobalContext.currentSuite = rootSuite;
}

export { Suite };
