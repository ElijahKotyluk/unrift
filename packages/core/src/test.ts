import { TaskStatus, type PromisableFn } from "./types";

interface TestTask {
  description: string;
  fn: PromisableFn<void>;
  result?: TestResult;
  run(): Promise<void>;
}

interface TestResult {
  status: Extract<TaskStatus, "pass" | "fail" | "skipped" | "todo" | "only">;
  error?: Error;
  durationMs?: number;
}

class Test implements TestTask {
  description: string;
  durationMs: number = 0;
  fn: PromisableFn<void>;
  status: TaskStatus = TaskStatus.Pending;

  error?: Error;

  constructor(description: string, fn: PromisableFn<void>) {
    this.description = description;
    this.fn = fn;
  }

  async run() {
    const start = performance.now();

    try {
      this.status = TaskStatus.Running;
      await this.fn();

      this.status = TaskStatus.Pass;
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.status = TaskStatus.Fail;
    } finally {
      this.durationMs = performance.now() - start;
    }
  }
}

export { Test, type TestResult, type TestTask, TaskStatus };
