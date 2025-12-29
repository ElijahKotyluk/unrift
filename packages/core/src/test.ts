import { TaskMode, TaskStatus, type PromisableFn } from "./types";

interface TestTask {
  description: string;
  fn: PromisableFn<void>;
  run(): Promise<void>;
}

class Test implements TestTask {
  description: string;
  durationMs: number = 0;
  error?: Error;

  fn: PromisableFn<void>;
  mode: TaskMode;

  status: TaskStatus = TaskStatus.Pending;

  constructor(
    description: string,
    fn: PromisableFn<void>,
    mode: TaskMode = TaskMode.Default,
  ) {
    this.description = description;
    this.fn = fn;
    this.mode = mode;
  }

  async run(timeoutMs?: number): Promise<void> {
    if (this.mode === TaskMode.Skip) {
      this.status = TaskStatus.Skipped;
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
            reject(new Error(`Test timed out after ${timeoutMs} ms`));
          }, timeoutMs);
        });

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
      this.error = error instanceof Error ? error : new Error(String(error));
      this.status = TaskStatus.Fail;
    } finally {
      this.durationMs = performance.now() - start;
    }
  }
}

export { Test, TaskStatus };
