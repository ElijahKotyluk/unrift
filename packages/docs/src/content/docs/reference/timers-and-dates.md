---
title: Timers and Dates
description: Control time deterministically with mock.useFakeTimers and mock.setSystemTime.
---

`mock.useFakeTimers()` swaps the host's timer functions, `Date`, and `performance.now` for a controllable fake clock. Tests drive time forward with `advanceTimersByTime`, drain everything with `runAllTimers`, or jump the wall clock with `setSystemTime`. `mock.useRealTimers()` (or `mock.restoreAll()`) puts everything back.

```ts
import { mock, afterEach } from "unrift";

afterEach(() => mock.restoreAll());

it("debounces", () => {
  mock.useFakeTimers();

  const fn = spy();
  setTimeout(fn, 100);

  expect(fn).not.toHaveBeenCalled();
  mock.advanceTimersByTime(100);
  expect(fn).toHaveBeenCalledTimes(1);
});
```

## What gets faked

| API | Faked by `useFakeTimers` |
| --- | --- |
| `setTimeout` / `clearTimeout` | ✓ |
| `setInterval` / `clearInterval` | ✓ |
| `setImmediate` / `clearImmediate` | ✓ |
| `queueMicrotask` | ✓ |
| `process.nextTick` | ✓ |
| `Date` constructor and `Date.now` | ✓ |
| `performance.now` | ✓ |
| `Date.parse` and `Date.UTC` | Unchanged (still useful for parsing) |

Everything is restored when you call `useRealTimers()` or `restoreAll()`.

## Advancing the clock

```ts
mock.advanceTimersByTime(ms);
```

Pumps every task whose scheduled time is ≤ `now + ms`, in priority order, then sets `now` to the new value. Tasks that schedule new tasks during execution are also drained (up to an internal safety cap that catches infinite loops).

```ts
mock.runAllTimers();
```

Drains every pending task - including ones scheduled by other tasks - until the queue is empty.

```ts
mock.runOnlyPendingTimers();
```

Snapshots the queue first and drains only the tasks that existed at call time. New tasks scheduled by the snapshotted callbacks stay pending.

```ts
mock.getTimerCount();
```

Returns the number of pending (non-cancelled) tasks.

## Async drainers

When a timer callback does `await` work, the sync drainers will fire the callback but return before the awaited promise settles. The async variants await the callback's return value and yield to the real microtask queue between pumps so any pending `.then` handlers get to run.

```ts
mock.useFakeTimers();

let value = 0;
setTimeout(async () => {
  await fetchSomething();
  value = 42;
}, 100);

// ❌ Sync - fires the callback but doesn't wait for the await chain.
mock.advanceTimersByTime(100);
expect(value).toBe(0);  // wrong order: passes here but breaks later

// ✅ Async - awaits the promise and flushes microtasks.
await mock.advanceTimersByTimeAsync(100);
expect(value).toBe(42);
```

The three async drainers mirror their sync siblings:

| Async | Sync sibling |
| --- | --- |
| `mock.advanceTimersByTimeAsync(ms)` | `advanceTimersByTime(ms)` |
| `mock.runAllTimersAsync()` | `runAllTimers()` |
| `mock.runOnlyPendingTimersAsync()` | `runOnlyPendingTimers()` |

What "yielding to microtasks" means concretely: between pumping each timer, the drainer does an internal `await Promise.resolve()`. Real `Promise.resolve()` is unaffected by fake timers - the engine uses its own internal microtask queue, not the fake `queueMicrotask` we patched. So pending `.then` handlers, `await` continuations, and `async` function tails all get a chance to settle between timer fires.

```ts
mock.useFakeTimers();

const order: string[] = [];
setTimeout(() => {
  order.push("first-timer");
  Promise.resolve().then(() => order.push("first-microtask"));
}, 100);
setTimeout(() => order.push("second-timer"), 100);

await mock.advanceTimersByTimeAsync(100);

// Microtask from the first timer's callback gets flushed before the
// second timer fires.
expect(order).toEqual(["first-timer", "first-microtask", "second-timer"]);
```

The infinite-loop guard from the sync drainers still applies - a callback that always schedules another timer at the same priority will hit the 10,000-iteration cap.

## Priority and microtasks

When tasks share the same `fireAt`, microtasks fire before macrotasks. `process.nextTick` is treated as microtask-priority - it runs before any `setTimeout`, even at the same scheduled time.

```ts
mock.useFakeTimers();

const order: string[] = [];
setTimeout(() => order.push("timeout"), 0);
queueMicrotask(() => order.push("microtask"));
process.nextTick(() => order.push("nextTick"));

mock.advanceTimersByTime(0);
// order === ["nextTick", "microtask", "timeout"]
```

## Selective faking

By default `useFakeTimers()` patches every supported API. To fake only a subset, pass `toFake`:

```ts
mock.useFakeTimers({ toFake: ["setTimeout", "Date"] });

// setTimeout and Date are faked
// setInterval, setImmediate, queueMicrotask, process.nextTick, performance are real
```

Or to fake everything _except_ certain APIs, pass `doNotFake`:

```ts
mock.useFakeTimers({ doNotFake: ["process.nextTick"] });

// Everything except process.nextTick is faked
```

The two options are mutually exclusive - passing both throws.

| `FakeableApi` value | What gets patched |
| --- | --- |
| `"setTimeout"` | `setTimeout` + `clearTimeout` (paired) |
| `"setInterval"` | `setInterval` + `clearInterval` (paired) |
| `"setImmediate"` | `setImmediate` + `clearImmediate` (paired) |
| `"queueMicrotask"` | `queueMicrotask` |
| `"process.nextTick"` | `process.nextTick` |
| `"Date"` | `Date` constructor, `Date.now`, `Date.parse`, `Date.UTC` |
| `"performance"` | `performance.now` |

Pair fakes are forced together - you can't fake `setTimeout` without also faking `clearTimeout`, because half-faked timers would be unusable (you'd schedule a fake and try to clear it with the real clearer).

`useRealTimers()` only restores the APIs that were actually patched, so leaving some real means leaving them truly real - they're not touched at any point.

## Initializing the clock

```ts
mock.useFakeTimers({ now: new Date("2024-01-01T00:00:00Z") });

expect(Date.now()).toBe(1_704_067_200_000);
expect(new Date().toISOString()).toBe("2024-01-01T00:00:00.000Z");
```

`now` accepts a `Date`, an ISO string, or epoch milliseconds. If omitted, the fake clock starts at `0`.

An invalid value - an unparseable string, an invalid `Date`, or a non-finite number (`NaN` / `Infinity`) - throws a clear error up front rather than silently setting the clock to `NaN` (which would break every scheduling and drain comparison). The same validation applies to [`setSystemTime`](#jumping-the-wall-clock-without-firing-timers). When `useFakeTimers` rejects the value, it's a clean no-op - no globals are patched.

## Jumping the wall clock without firing timers

`setSystemTime` advances `Date.now()` without draining any scheduled tasks. Useful when the code under test reads `Date.now()` directly but you don't want pending timeouts to fire just because the clock moved.

```ts
mock.useFakeTimers({ now: 0 });
const fn = spy();
setTimeout(fn, 5_000);

mock.setSystemTime(10_000);

expect(Date.now()).toBe(10_000);
expect(fn).not.toHaveBeenCalled(); // timer still pending
```

## Getting the real clock

`mock.getRealSystemTime()` always returns the actual system time, even while fake timers are installed:

```ts
mock.useFakeTimers({ now: 0 });
const realNow = mock.getRealSystemTime();
expect(realNow).toBeGreaterThan(1_700_000_000_000);
```

## instanceof Date

The fake `Date` is a subclass-style proxy that preserves `instanceof Date`:

```ts
mock.useFakeTimers();
expect(new Date() instanceof Date).toBe(true);
```

## Cleanup idiom

Use `afterEach` rather than `beforeEach` so the last test in the file is also cleaned up before the runner measures its own duration:

```ts
import { afterEach, mock } from "unrift";

afterEach(() => {
  mock.restoreAll();
});
```

## Common pitfalls

- **Forgetting to advance time.** A `setTimeout` will sit in the queue forever until you call `advanceTimersByTime` or `runAllTimers`.
- **Real `setTimeout` from a stale closure.** If you capture `setTimeout` into a variable before installing fake timers, the variable still points at the real one. Always reference globals directly inside the test body.
- **Recursive timers in `runAllTimers`.** A callback that always schedules another timer hits the internal safety cap (10,000 iterations) and throws. Use `runOnlyPendingTimers` to drain just one wave.
- **Asserting against `Date.now()` from outside the test.** Don't compare a fake `Date.now()` to a value captured before `useFakeTimers()` was called.
