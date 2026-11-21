import { TaskMode, TaskStatus, type PromisableFn } from "./types";
import { toError } from "./utils/toError";

/**
 * Captured at module load so the runner's own timing measurements are
 * immune to user mocks (e.g. mock.useFakeTimers patches performance.now).
 */
const realPerformanceNow = performance.now.bind(performance);

// Names repeat, this doesn't. See Suite.testId.
let nextId = 0;

export class Test {
  readonly id = nextId++;
  description: string;
  durationMs: number = 0;
  error?: Error;

  fn: PromisableFn<void>;
  mode: TaskMode;

  status: TaskStatus = TaskStatus.Pending;
  timeoutMs?: number;
  retries?: number;
  attempts: number = 0;
  /** True if the last run timed out. Its body may still be running. */
  timedOut: boolean = false;

  constructor(
    description: string,
    fn: PromisableFn<void>,
    mode: TaskMode = TaskMode.Default,
    timeoutMs?: number,
    retries?: number,
  ) {
    this.description = description;
    this.fn = fn;
    this.mode = mode;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  async run(globalTimeoutMs?: number): Promise<void> {
    const timeoutMs = this.timeoutMs ?? globalTimeoutMs;
    if (this.mode === TaskMode.Skip) {
      this.status = TaskStatus.Skipped;
      this.durationMs = 0;

      return;
    }

    if (this.mode === TaskMode.Todo) {
      this.status = TaskStatus.Todo;
      this.durationMs = 0;

      return;
    }

    const start = realPerformanceNow();
    this.status = TaskStatus.Running;
    this.timedOut = false;

    const exec = Promise.resolve().then(() => this.fn());

    try {
      if (timeoutMs !== undefined) {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const timeoutFn = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            this.timedOut = true;
            reject(
              new Error(
                `Test "${this.description}" timed out after ${timeoutMs} ms`,
              ),
            );
          }, timeoutMs);
        });

        /**
         * NOTE: Promise.race does not cancel the losing promise. A timed-out test
         * function continues running in the background. True cancellation would
         * require AbortController integration, which is a larger future change.
         */
        try {
          await Promise.race([exec, timeoutFn]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      } else {
        await exec;
      }

      this.status = TaskStatus.Pass;
    } catch (error) {
      this.error = toError(error);
      this.status = TaskStatus.Fail;
    } finally {
      this.durationMs = realPerformanceNow() - start;
    }
  }
}
