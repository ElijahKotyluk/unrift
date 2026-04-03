import { TaskMode, TaskStatus, type PromisableFn } from "./types";
import { toError } from "./utils/toError";

export class Test {
  description: string;
  durationMs: number = 0;
  error?: Error;

  fn: PromisableFn<void>;
  mode: TaskMode;

  status: TaskStatus = TaskStatus.Pending;
  timeoutMs?: number;

  constructor(
    description: string,
    fn: PromisableFn<void>,
    mode: TaskMode = TaskMode.Default,
    timeoutMs?: number,
  ) {
    this.description = description;
    this.fn = fn;
    this.mode = mode;
    this.timeoutMs = timeoutMs;
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

    const start = performance.now();
    this.status = TaskStatus.Running;

    const exec = Promise.resolve().then(() => this.fn());

    try {
      if (timeoutMs !== undefined) {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const timeoutFn = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `Test "${this.description}" timed out after ${timeoutMs} ms`,
              ),
            );
          }, timeoutMs);
        });

        // NOTE: Promise.race does not cancel the losing promise. A timed-out test
        // function continues running in the background. True cancellation would
        // require AbortController integration, which is a larger future change.
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
      this.durationMs = performance.now() - start;
    }
  }
}
