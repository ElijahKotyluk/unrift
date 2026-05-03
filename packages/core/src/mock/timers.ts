/**
 * Fake clock — controllable replacements for `setTimeout`, `setInterval`,
 * `setImmediate`, `process.nextTick`, `queueMicrotask`, `Date`, `Date.now`,
 * and `performance.now`.
 *
 * Tests opt in via `mock.useFakeTimers()` and drain queued tasks deterministically
 * with `advanceTimersByTime(ms)` / `runAllTimers()` / `runOnlyPendingTimers()`.
 *
 * Restoration:
 *   - `mock.useRealTimers()` reverts every patched global to its original
 *   - `mock.restoreAll()` does the same as part of bulk cleanup
 */

import { activeRestorers } from "./spy";

// Task model

type TaskKind = "timeout" | "interval" | "immediate" | "microtask";

interface FakeTask {
  id: number;
  kind: TaskKind;
  fireAt: number;
  // Sequence number for FIFO ordering among tasks with the same fireAt + priority.
  seq: number;
  callback: (...args: unknown[]) => void;
  args: unknown[];
  // For intervals: re-schedule with this period after firing.
  periodMs?: number;
  // Cleared via clearTimeout/clearInterval/clearImmediate — drained but not run.
  cancelled: boolean;
}

const PRIORITY: Record<TaskKind, number> = {
  microtask: 0,
  immediate: 1,
  timeout: 2,
  interval: 2,
};

// State

let installed = false;
let now = 0;
let nextId = 1;
let nextSeq = 0;
const queue: FakeTask[] = [];

// Originals captured on install so we can restore them on useRealTimers.
interface Originals {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  setImmediate: typeof globalThis.setImmediate | undefined;
  clearImmediate: typeof globalThis.clearImmediate | undefined;
  queueMicrotask: typeof globalThis.queueMicrotask;
  processNextTick:
    | ((callback: (...args: unknown[]) => void, ...args: unknown[]) => void)
    | undefined;
  Date: typeof globalThis.Date;
  performanceNow: (() => number) | undefined;
}

let originals: Originals | undefined;
const realDate = globalThis.Date;
const realDateNow = realDate.now.bind(realDate);

// Queue operations

function compareTasks(a: FakeTask, b: FakeTask): number {
  if (a.fireAt !== b.fireAt) return a.fireAt - b.fireAt;
  const pa = PRIORITY[a.kind];
  const pb = PRIORITY[b.kind];
  if (pa !== pb) return pa - pb;
  return a.seq - b.seq;
}

function enqueue(task: FakeTask): void {
  /**
   * Linear insertion keeps the queue sorted. Test workloads rarely have
   * enough pending tasks for a heap to matter.
   */
  let i = 0;
  while (i < queue.length && compareTasks(queue[i], task) <= 0) i++;
  queue.splice(i, 0, task);
}

function findIndexById(id: number): number {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].id === id) return i;
  }
  return -1;
}

// Patched timer functions

function fakeSetTimeout(
  callback: (...args: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): number {
  const task: FakeTask = {
    id: nextId++,
    kind: "timeout",
    fireAt: now + Math.max(0, ms ?? 0),
    seq: nextSeq++,
    callback,
    args,
    cancelled: false,
  };
  enqueue(task);
  return task.id;
}

function fakeClearTimeout(id?: number | { id?: number } | null): void {
  if (id == null) return;
  const numericId = typeof id === "number" ? id : id.id;
  if (numericId == null) return;

  const index = findIndexById(numericId);
  if (index !== -1) queue[index].cancelled = true;
}

function fakeSetInterval(
  callback: (...args: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): number {
  const period = Math.max(1, ms ?? 0);
  const task: FakeTask = {
    id: nextId++,
    kind: "interval",
    fireAt: now + period,
    seq: nextSeq++,
    callback,
    args,
    periodMs: period,
    cancelled: false,
  };
  enqueue(task);
  return task.id;
}

function fakeSetImmediate(
  callback: (...args: unknown[]) => void,
  ...args: unknown[]
): number {
  const task: FakeTask = {
    id: nextId++,
    kind: "immediate",
    fireAt: now,
    seq: nextSeq++,
    callback,
    args,
    cancelled: false,
  };
  enqueue(task);
  return task.id;
}

function fakeQueueMicrotask(callback: () => void): void {
  const task: FakeTask = {
    id: nextId++,
    kind: "microtask",
    fireAt: now,
    seq: nextSeq++,
    callback,
    args: [],
    cancelled: false,
  };
  enqueue(task);
}

// Date replacement

function makeFakeDate(): typeof globalThis.Date {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FakeDate = function (this: unknown, ...args: any[]) {
    if (!new.target) {
      /**
       * Date(...) without `new` returns a string of the *current* time —
       * which when faked should reflect the fake clock.
       */
      return new realDate(now).toString();
    }
    if (args.length === 0) {
      return Reflect.construct(realDate, [now], new.target);
    }
    return Reflect.construct(realDate, args, new.target);
  } as unknown as typeof globalThis.Date;

  /**
   * Inherit static surface and instance prototype from the real Date.
   * The cast is needed because `prototype` is typed as readonly on `typeof Date`
   * even though it's actually writable on a function value.
   */
  Object.setPrototypeOf(FakeDate, realDate);
  (FakeDate as unknown as { prototype: unknown }).prototype =
    realDate.prototype;

  FakeDate.now = () => now;
  FakeDate.parse = realDate.parse.bind(realDate);
  FakeDate.UTC = realDate.UTC.bind(realDate);

  return FakeDate;
}

// Drain

const MAX_DRAIN_ITERATIONS = 10_000;

// Pull and run the head task. Re-queues intervals. Skips cancelled tasks.
function pumpOne(): boolean {
  while (queue.length > 0 && queue[0].cancelled) queue.shift();
  if (queue.length === 0) return false;

  const task = queue.shift()!;
  now = Math.max(now, task.fireAt);

  if (task.kind === "interval") {
    /**
     * Re-schedule before firing so a callback that calls clearInterval()
     * can find the task in the queue.
     */
    const next: FakeTask = {
      ...task,
      seq: nextSeq++,
      fireAt: now + (task.periodMs ?? 1),
    };
    enqueue(next);
  }

  task.callback(...task.args);
  return true;
}

function advanceTo(target: number): void {
  let iterations = 0;
  while (queue.length > 0) {
    while (queue.length > 0 && queue[0].cancelled) queue.shift();
    if (queue.length === 0) break;
    if (queue[0].fireAt > target) break;
    pumpOne();
    if (++iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(
        "advanceTimersByTime exceeded the maximum drain iterations — " +
          "is a timer scheduling itself in a loop?",
      );
    }
  }
  if (target > now) now = target;
}

// Public API

export interface UseFakeTimersOptions {
  // Initial system time. Accepts a Date, ISO string, or epoch milliseconds.
  now?: Date | string | number;
}

function ensureInstalled(method: string): void {
  if (!installed) {
    throw new Error(
      `mock.${method}() requires fake timers — call mock.useFakeTimers() first`,
    );
  }
}

function toMillis(value: Date | string | number): number {
  if (value instanceof realDate) return value.getTime();
  if (typeof value === "number") return value;
  return new realDate(value).getTime();
}

export function useFakeTimers(options: UseFakeTimersOptions = {}): void {
  if (installed) return;
  installed = true;

  originals = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setImmediate:
      typeof globalThis.setImmediate !== "undefined"
        ? globalThis.setImmediate
        : undefined,
    clearImmediate:
      typeof globalThis.clearImmediate !== "undefined"
        ? globalThis.clearImmediate
        : undefined,
    queueMicrotask: globalThis.queueMicrotask,
    processNextTick:
      typeof process !== "undefined" && process.nextTick
        ? (process.nextTick as Originals["processNextTick"])
        : undefined,
    Date: globalThis.Date,
    performanceNow:
      typeof globalThis.performance !== "undefined" &&
      typeof globalThis.performance.now === "function"
        ? globalThis.performance.now.bind(globalThis.performance)
        : undefined,
  };

  now = options.now !== undefined ? toMillis(options.now) : 0;
  queue.length = 0;

  // Patch globals
  globalThis.setTimeout =
    fakeSetTimeout as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout =
    fakeClearTimeout as unknown as typeof globalThis.clearTimeout;
  globalThis.setInterval =
    fakeSetInterval as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval =
    fakeClearTimeout as unknown as typeof globalThis.clearInterval;
  if (originals.setImmediate) {
    globalThis.setImmediate =
      fakeSetImmediate as unknown as typeof globalThis.setImmediate;
    globalThis.clearImmediate =
      fakeClearTimeout as unknown as typeof globalThis.clearImmediate;
  }
  globalThis.queueMicrotask = fakeQueueMicrotask;

  if (originals.processNextTick && typeof process !== "undefined") {
    /**
     * process.nextTick has the highest priority in Node. schedule with
     * microtask priority so it fires before macrotasks at the same time.
     */
    (process as { nextTick: typeof fakeQueueMicrotask }).nextTick = ((
      callback: (...args: unknown[]) => void,
      ...args: unknown[]
    ) => {
      const task: FakeTask = {
        id: nextId++,
        kind: "microtask",
        fireAt: now,
        seq: nextSeq++,
        callback,
        args,
        cancelled: false,
      };
      enqueue(task);
    }) as unknown as typeof fakeQueueMicrotask;
  }

  globalThis.Date = makeFakeDate();

  if (originals.performanceNow && globalThis.performance) {
    globalThis.performance.now = (() => now) as typeof performance.now;
  }

  activeRestorers.add(useRealTimers);
}

export function useRealTimers(): void {
  if (!installed || !originals) return;

  globalThis.setTimeout = originals.setTimeout;
  globalThis.clearTimeout = originals.clearTimeout;
  globalThis.setInterval = originals.setInterval;
  globalThis.clearInterval = originals.clearInterval;
  if (originals.setImmediate) {
    globalThis.setImmediate = originals.setImmediate;
  }
  if (originals.clearImmediate) {
    globalThis.clearImmediate = originals.clearImmediate;
  }
  globalThis.queueMicrotask = originals.queueMicrotask;
  if (originals.processNextTick && typeof process !== "undefined") {
    (process as { nextTick: typeof originals.processNextTick }).nextTick =
      originals.processNextTick;
  }
  globalThis.Date = originals.Date;
  if (originals.performanceNow && globalThis.performance) {
    globalThis.performance.now =
      originals.performanceNow as typeof performance.now;
  }

  installed = false;
  originals = undefined;
  queue.length = 0;
  now = 0;

  activeRestorers.delete(useRealTimers);
}

export function advanceTimersByTime(ms: number): void {
  ensureInstalled("advanceTimersByTime");
  advanceTo(now + Math.max(0, ms));
}

export function runAllTimers(): void {
  ensureInstalled("runAllTimers");
  let iterations = 0;
  while (queue.length > 0) {
    while (queue.length > 0 && queue[0].cancelled) queue.shift();
    if (queue.length === 0) break;
    pumpOne();
    if (++iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(
        "runAllTimers exceeded the maximum drain iterations — " +
          "is a timer scheduling itself in a loop?",
      );
    }
  }
}

export function runOnlyPendingTimers(): void {
  ensureInstalled("runOnlyPendingTimers");
  // Snapshot ids that exist NOW; only drain those, even if they schedule new ones.
  const targetIds = new Set<number>(queue.map((t) => t.id));
  let iterations = 0;

  while (queue.length > 0) {
    while (queue.length > 0 && queue[0].cancelled) queue.shift();
    if (queue.length === 0) break;
    if (!targetIds.has(queue[0].id)) break;
    pumpOne();
    if (++iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(
        "runOnlyPendingTimers exceeded the maximum drain iterations",
      );
    }
  }
}

export function getTimerCount(): number {
  ensureInstalled("getTimerCount");
  let count = 0;
  for (const task of queue) if (!task.cancelled) count++;
  return count;
}

export function setSystemTime(value: Date | string | number): void {
  ensureInstalled("setSystemTime");
  now = toMillis(value);
}

export function getRealSystemTime(): number {
  return realDateNow();
}
