type Promisable<T> = Promise<T> | T;
export type PromisableFn<T> = () => Promisable<T>;

export enum TaskStatus {
  Pending = "pending",
  Running = "running",
  Pass = "pass",
  Fail = "fail",
  Only = "only",
  Skipped = "skipped",
  Todo = "todo",
}

export enum TaskMode {
  Default = "default",
  Only = "only",
  Skip = "skip",
}

export interface MatcherContext {
  isNot: boolean;
  diff(a: unknown, b: unknown): string;
}

export type MatcherFn = (
  this: MatcherContext,
  received: unknown,
  ...args: readonly unknown[]
) => void | Promise<void>;

export type MatcherMap = Record<string, MatcherFn>;
