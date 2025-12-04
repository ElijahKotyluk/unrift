type Promisable<T> = Promise<T> | T;
type PromisableFn<T> = () => Promisable<T>;

enum TaskStatus {
  Pending = "pending",
  Running = "running",
  Pass = "pass",
  Fail = "fail",
  Only = "only",
  Skipped = "skipped",
  Todo = "todo",
}

export type { Promisable, PromisableFn };
export { TaskStatus };
