/**
 * Fake clock - controllable replacements for `setTimeout`, `setInterval`,
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
  // Cleared via clearTimeout/clearInterval/clearImmediate - drained but not run.
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
       * Date(...) without `new` returns a string of the *current* time -
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
        "advanceTimersByTime exceeded the maximum drain iterations - " +
          "is a timer scheduling itself in a loop?",
      );
    }
  }
  if (target > now) now = target;
}

// Public API

/**
 * Names of host APIs that `useFakeTimers` can patch. `setTimeout` implicitly
 * pairs with `clearTimeout`, `setInterval` with `clearInterval`, and
 * `setImmediate` with `clearImmediate` - you can't fake one half of a pair
 * without breaking the other.
 */
export type FakeableApi =
  | "setTimeout"
  | "setInterval"
  | "setImmediate"
  | "queueMicrotask"
  | "process.nextTick"
  | "Date"
  | "performance";

const ALL_FAKEABLE: readonly FakeableApi[] = [
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "process.nextTick",
  "Date",
  "performance",
];

export interface UseFakeTimersOptions {
  // Initial system time. Accepts a Date, ISO string, or epoch milliseconds.
  now?: Date | string | number;
  /**
   * Opt-in: only the listed APIs are faked; everything else stays real.
   * Mutually exclusive with `doNotFake`.
   */
  toFake?: readonly FakeableApi[];
  /**
   * Opt-out: everything is faked except the listed APIs.
   * Mutually exclusive with `toFake`.
   */
  doNotFake?: readonly FakeableApi[];
}

function resolveFakedSet(options: UseFakeTimersOptions): Set<FakeableApi> {
  if (options.toFake !== undefined && options.doNotFake !== undefined) {
    throw new Error(
      "mock.useFakeTimers(): `toFake` and `doNotFake` are mutually exclusive",
    );
  }
  if (options.toFake !== undefined) {
    return new Set(options.toFake);
  }
  if (options.doNotFake !== undefined) {
    const excluded = new Set(options.doNotFake);
    return new Set(ALL_FAKEABLE.filter((api) => !excluded.has(api)));
  }
  return new Set(ALL_FAKEABLE);
}

// Tracks what was actually patched on the most recent useFakeTimers call,
// so useRealTimers knows which originals to restore.
let fakedApis: Set<FakeableApi> = new Set();

// The own descriptor `performance` had for `now` before we shadowed it
// (undefined if `now` was inherited from the prototype).
let originalPerfNowDescriptor: PropertyDescriptor | undefined;

/**
 * Patch `performance.now` to read the fake clock. Uses `defineProperty`
 * rather than assignment because on Node 18 `performance.now` is a
 * non-writable prototype method - plain assignment throws. Defining an own
 * property on the instance shadows it safely.
 *
 * Returns false (without throwing) if the platform won't allow it, so a
 * failure here never aborts the rest of the timer install.
 */
function patchPerformanceNow(): boolean {
  const perf = globalThis.performance as { now?: unknown } | undefined;
  if (!perf || typeof perf.now !== "function") return false;

  try {
    originalPerfNowDescriptor = Object.getOwnPropertyDescriptor(perf, "now");
    Object.defineProperty(perf, "now", {
      configurable: true,
      writable: true,
      value: () => now,
    });
    return true;
  } catch {
    return false;
  }
}

/** Reverse `patchPerformanceNow`. Best-effort - never throws. */
function restorePerformanceNow(): void {
  const perf = globalThis.performance as { now?: unknown } | undefined;
  if (!perf) return;

  try {
    if (originalPerfNowDescriptor) {
      Object.defineProperty(perf, "now", originalPerfNowDescriptor);
    } else {
      // We added a shadow own property; deleting it reveals the real
      // prototype method again.
      delete perf.now;
    }
  } catch {
    // ignore - leaving the fake in place is better than throwing on cleanup
  }
  originalPerfNowDescriptor = undefined;
}

function ensureInstalled(method: string): void {
  if (!installed) {
    throw new Error(
      `mock.${method}() requires fake timers - call mock.useFakeTimers() first`,
    );
  }
}

function toMillis(value: Date | string | number): number {
  let ms: number;
  if (value instanceof realDate) ms = value.getTime();
  else if (typeof value === "number") ms = value;
  else ms = new realDate(value).getTime();

  // Reject NaN (invalid Date / unparseable string) and ±Infinity up front.
  // Letting a non-finite value become the fake clock would silently break
  // every scheduling and drain comparison (now + ms, fireAt > target, …).
  if (!Number.isFinite(ms)) {
    const shown =
      typeof value === "string" ? JSON.stringify(value) : String(value);
    throw new TypeError(
      `mock fake-timers: invalid time value ${shown} - expected a valid Date, ` +
        `a parseable date string, or finite epoch milliseconds`,
    );
  }
  return ms;
}

export function useFakeTimers(options: UseFakeTimersOptions = {}): void {
  if (installed) return;

  // Resolve options that can throw BEFORE flipping `installed` or touching
  // any global - so an invalid `toFake`/`doNotFake` combo or a bad `now`
  // leaves useFakeTimers a clean no-op rather than a half-installed state.
  const toFake = resolveFakedSet(options);
  const initialNow = options.now !== undefined ? toMillis(options.now) : 0;

  installed = true;
  fakedApis = toFake;

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

  now = initialNow;
  queue.length = 0;

  // Register the restorer BEFORE patching anything, so even a mid-install
  // failure leaves a globally-installed fake that restoreAll can undo.
  // Without this, a throw between here and the end would strand the real
  // timers permanently - see the Node 18 performance.now issue.
  activeRestorers.add(useRealTimers);

  // Patch globals - each pair gated on the resolved fake set.
  if (toFake.has("setTimeout")) {
    globalThis.setTimeout =
      fakeSetTimeout as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout =
      fakeClearTimeout as unknown as typeof globalThis.clearTimeout;
  }
  if (toFake.has("setInterval")) {
    globalThis.setInterval =
      fakeSetInterval as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval =
      fakeClearTimeout as unknown as typeof globalThis.clearInterval;
  }
  if (toFake.has("setImmediate") && originals.setImmediate) {
    globalThis.setImmediate =
      fakeSetImmediate as unknown as typeof globalThis.setImmediate;
    globalThis.clearImmediate =
      fakeClearTimeout as unknown as typeof globalThis.clearImmediate;
  }
  if (toFake.has("queueMicrotask")) {
    globalThis.queueMicrotask = fakeQueueMicrotask;
  }

  if (
    toFake.has("process.nextTick") &&
    originals.processNextTick &&
    typeof process !== "undefined"
  ) {
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

  if (toFake.has("Date")) {
    globalThis.Date = makeFakeDate();
  }

  if (toFake.has("performance")) {
    // If the platform won't let us patch performance.now (e.g. it's a
    // non-configurable accessor), drop it from the faked set so restore
    // doesn't try to undo something we never did.
    if (!patchPerformanceNow()) {
      fakedApis.delete("performance");
    }
  }
}

export function useRealTimers(): void {
  if (!installed || !originals) return;

  // Only restore the APIs that were actually patched. Touching globals
  // we didn't touch would clobber user-set values or other mocks.
  if (fakedApis.has("setTimeout")) {
    globalThis.setTimeout = originals.setTimeout;
    globalThis.clearTimeout = originals.clearTimeout;
  }
  if (fakedApis.has("setInterval")) {
    globalThis.setInterval = originals.setInterval;
    globalThis.clearInterval = originals.clearInterval;
  }
  if (fakedApis.has("setImmediate")) {
    if (originals.setImmediate)
      globalThis.setImmediate = originals.setImmediate;
    if (originals.clearImmediate)
      globalThis.clearImmediate = originals.clearImmediate;
  }
  if (fakedApis.has("queueMicrotask")) {
    globalThis.queueMicrotask = originals.queueMicrotask;
  }
  if (
    fakedApis.has("process.nextTick") &&
    originals.processNextTick &&
    typeof process !== "undefined"
  ) {
    (process as { nextTick: typeof originals.processNextTick }).nextTick =
      originals.processNextTick;
  }
  if (fakedApis.has("Date")) {
    globalThis.Date = originals.Date;
  }
  if (fakedApis.has("performance")) {
    restorePerformanceNow();
  }

  installed = false;
  originals = undefined;
  fakedApis = new Set();
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
        "runAllTimers exceeded the maximum drain iterations - " +
          "is a timer scheduling itself in a loop?",
      );
    }
  }
}

export function runOnlyPendingTimers(): void {
  ensureInstalled("runOnlyPendingTimers");
  // Snapshot by `seq`, not `id`: a re-fired interval re-enqueues itself with
  // the SAME id but a fresh seq (see pumpOne). Snapshotting ids would keep the
  // interval "in scope" forever and drain it every tick until the guard trips.
  // seq is unique per enqueue, so the re-scheduled tick counts as newly
  // scheduled and is left pending.
  const targetSeqs = new Set<number>(queue.map((t) => t.seq));
  let iterations = 0;

  while (queue.length > 0) {
    while (queue.length > 0 && queue[0].cancelled) queue.shift();
    if (queue.length === 0) break;
    if (!targetSeqs.has(queue[0].seq)) break;
    pumpOne();
    if (++iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(
        "runOnlyPendingTimers exceeded the maximum drain iterations",
      );
    }
  }
}

/**
 * Like `pumpOne`, but if the callback returns a thenable, awaits it before
 * resolving, and yields to the real microtask queue afterward so any
 * microtasks the callback queued can settle before the next pump.
 *
 * The `await Promise.resolve()` at the end is the key. It lets pending
 * microtasks (resolved Promises, queued `.then` handlers) flush. Real
 * `Promise.resolve()` is unaffected by `mock.useFakeTimers()` - the engine
 * uses its internal microtask queue, not our fake `queueMicrotask`.
 */
async function pumpOneAsync(): Promise<boolean> {
  while (queue.length > 0 && queue[0].cancelled) queue.shift();
  if (queue.length === 0) return false;

  const task = queue.shift()!;
  now = Math.max(now, task.fireAt);

  if (task.kind === "interval") {
    const next: FakeTask = {
      ...task,
      seq: nextSeq++,
      fireAt: now + (task.periodMs ?? 1),
    };
    enqueue(next);
  }

  const result = task.callback(...task.args);
  if (
    result !== undefined &&
    result !== null &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    await (result as Promise<unknown>);
  }

  // Yield once more so microtasks scheduled by the callback (after any
  // awaited promise resolved) can run before we move on.
  await Promise.resolve();

  return true;
}

/**
 * Like `advanceTimersByTime`, but awaits Promise return values from
 * timer callbacks and yields to microtasks between pumps. Use this when
 * the code under test does `await` work inside a `setTimeout` callback.
 */
export async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  ensureInstalled("advanceTimersByTimeAsync");
  const target = now + Math.max(0, ms);
  let iterations = 0;
  while (queue.length > 0) {
    while (queue.length > 0 && queue[0].cancelled) queue.shift();
    if (queue.length === 0) break;
    if (queue[0].fireAt > target) break;
    await pumpOneAsync();
    if (++iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(
        "advanceTimersByTimeAsync exceeded the maximum drain iterations - " +
          "is a timer scheduling itself in a loop?",
      );
    }
  }
  if (target > now) now = target;
}

/** Async sibling of `runAllTimers`. */
export async function runAllTimersAsync(): Promise<void> {
  ensureInstalled("runAllTimersAsync");
  let iterations = 0;
  while (queue.length > 0) {
    while (queue.length > 0 && queue[0].cancelled) queue.shift();
    if (queue.length === 0) break;
    await pumpOneAsync();
    if (++iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(
        "runAllTimersAsync exceeded the maximum drain iterations - " +
          "is a timer scheduling itself in a loop?",
      );
    }
  }
}

/** Async sibling of `runOnlyPendingTimers`. */
export async function runOnlyPendingTimersAsync(): Promise<void> {
  ensureInstalled("runOnlyPendingTimersAsync");
  // Snapshot by `seq` for the same reason as the sync variant: a re-fired
  // interval re-enqueues with the same id but a fresh seq, so id-based
  // snapshotting would drain it every tick until the guard trips.
  const targetSeqs = new Set<number>(queue.map((t) => t.seq));
  let iterations = 0;
  while (queue.length > 0) {
    while (queue.length > 0 && queue[0].cancelled) queue.shift();
    if (queue.length === 0) break;
    if (!targetSeqs.has(queue[0].seq)) break;
    await pumpOneAsync();
    if (++iterations > MAX_DRAIN_ITERATIONS) {
      throw new Error(
        "runOnlyPendingTimersAsync exceeded the maximum drain iterations",
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
