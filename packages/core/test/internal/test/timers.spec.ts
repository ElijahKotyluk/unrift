import { describe, it, expect, afterEach, mock, spy } from "@unrift/core";

// Restore real timers (and any other mocks) AFTER every test so the very
// last test's fake clock can't pollute the runner's `performance.now()`
// duration measurement at file end.
afterEach(() => {
  mock.restoreAll();
});

describe("mock.useFakeTimers — install / uninstall", () => {
  it("install/uninstall is idempotent across multiple calls", () => {
    mock.useFakeTimers();
    mock.useFakeTimers(); // second call is a no-op
    mock.useRealTimers();
    mock.useRealTimers(); // also safe
  });

  it("useRealTimers restores setTimeout to the original implementation", () => {
    const realSetTimeout = setTimeout;
    mock.useFakeTimers();
    expect(setTimeout).not.toBe(realSetTimeout);

    mock.useRealTimers();
    expect(setTimeout).toBe(realSetTimeout);
  });

  it("mock.restoreAll() restores timers", () => {
    const realSetTimeout = setTimeout;
    mock.useFakeTimers();
    mock.restoreAll();
    expect(setTimeout).toBe(realSetTimeout);
  });

  it("operations throw a clear error when timers aren't faked", () => {
    expect(() => mock.advanceTimersByTime(100)).toThrow(
      "requires fake timers",
    );
    expect(() => mock.runAllTimers()).toThrow("requires fake timers");
    expect(() => mock.getTimerCount()).toThrow("requires fake timers");
  });
});

describe("mock — setTimeout", () => {
  it("does not fire before time advances", () => {
    mock.useFakeTimers();
    const fn = spy();
    setTimeout(fn, 100);
    expect(fn.mock.calls).toEqual([]);
  });

  it("fires when time advances past its scheduled moment", () => {
    mock.useFakeTimers();
    const fn = spy();
    setTimeout(fn, 100);

    mock.advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(1);
  });

  it("only fires once even if advanced far past", () => {
    mock.useFakeTimers();
    const fn = spy();
    setTimeout(fn, 50);

    mock.advanceTimersByTime(10_000);
    expect(fn.mock.calls).toHaveLength(1);
  });

  it("clearTimeout cancels a pending timeout", () => {
    mock.useFakeTimers();
    const fn = spy();
    const id = setTimeout(fn, 100);
    clearTimeout(id);

    mock.advanceTimersByTime(100);
    expect(fn.mock.calls).toEqual([]);
  });

  it("forwards extra arguments to the callback", () => {
    mock.useFakeTimers();
    const fn = spy();
    setTimeout(fn, 50, "a", "b", 3);

    mock.advanceTimersByTime(50);
    expect(fn.mock.calls[0]).toEqual(["a", "b", 3]);
  });

  it("treats negative or undefined delay as 0", () => {
    mock.useFakeTimers();
    const fn = spy();
    setTimeout(fn, -1000);

    mock.advanceTimersByTime(0);
    expect(fn.mock.calls).toHaveLength(1);
  });
});

describe("mock — setInterval", () => {
  it("fires every period until cleared", () => {
    mock.useFakeTimers();
    const fn = spy();
    setInterval(fn, 100);

    mock.advanceTimersByTime(350);
    expect(fn.mock.calls).toHaveLength(3);
  });

  it("clearInterval stops further fires", () => {
    mock.useFakeTimers();
    const fn = spy();
    const id = setInterval(fn, 100);

    mock.advanceTimersByTime(150);
    expect(fn.mock.calls).toHaveLength(1);

    clearInterval(id);
    mock.advanceTimersByTime(500);
    expect(fn.mock.calls).toHaveLength(1);
  });

  it("a callback that calls clearInterval stops itself", () => {
    mock.useFakeTimers();
    let count = 0;
    const id = setInterval(() => {
      count++;
      if (count === 2) clearInterval(id);
    }, 100);

    mock.advanceTimersByTime(1000);
    expect(count).toBe(2);
  });
});

describe("mock — queueMicrotask and process.nextTick", () => {
  it("microtasks fire before macrotasks scheduled at the same time", () => {
    mock.useFakeTimers();
    const order: string[] = [];

    setTimeout(() => order.push("timeout"), 0);
    queueMicrotask(() => order.push("microtask"));

    mock.advanceTimersByTime(0);
    expect(order).toEqual(["microtask", "timeout"]);
  });

  it("process.nextTick fires before timers", () => {
    mock.useFakeTimers();
    const order: string[] = [];

    setTimeout(() => order.push("timeout"), 0);
    process.nextTick(() => order.push("nextTick"));

    mock.advanceTimersByTime(0);
    expect(order).toEqual(["nextTick", "timeout"]);
  });
});

describe("mock — runAllTimers", () => {
  it("drains every scheduled task in order", () => {
    mock.useFakeTimers();
    const order: number[] = [];
    setTimeout(() => order.push(1), 100);
    setTimeout(() => order.push(2), 50);
    setTimeout(() => order.push(3), 200);

    mock.runAllTimers();
    expect(order).toEqual([2, 1, 3]);
  });

  it("drains tasks scheduled by other tasks (re-entry)", () => {
    mock.useFakeTimers();
    const order: number[] = [];
    setTimeout(() => {
      order.push(1);
      setTimeout(() => order.push(2), 50);
    }, 50);

    mock.runAllTimers();
    expect(order).toEqual([1, 2]);
  });

  it("throws when timers schedule themselves in an infinite loop", () => {
    mock.useFakeTimers();
    const recur = () => setTimeout(recur, 1);
    setTimeout(recur, 1);

    expect(() => mock.runAllTimers()).toThrow("maximum drain iterations");
  });
});

describe("mock — runOnlyPendingTimers", () => {
  it("drains only the timers that existed at call time", () => {
    mock.useFakeTimers();
    const order: number[] = [];
    setTimeout(() => {
      order.push(1);
      setTimeout(() => order.push(2), 50);
    }, 50);

    mock.runOnlyPendingTimers();
    expect(order).toEqual([1]);

    // The second one (scheduled by the first) is now pending; advance to fire it.
    mock.advanceTimersByTime(100);
    expect(order).toEqual([1, 2]);
  });
});

describe("mock — getTimerCount", () => {
  it("counts only non-cancelled pending timers", () => {
    mock.useFakeTimers();
    setTimeout(() => {}, 100);
    const id = setTimeout(() => {}, 200);
    setInterval(() => {}, 50);

    expect(mock.getTimerCount()).toBe(3);

    clearTimeout(id);
    expect(mock.getTimerCount()).toBe(2);
  });

  it("returns 0 when nothing is scheduled", () => {
    mock.useFakeTimers();
    expect(mock.getTimerCount()).toBe(0);
  });
});

describe("mock — Date", () => {
  it("Date.now() returns the fake clock", () => {
    mock.useFakeTimers({ now: 1_000_000 });
    expect(Date.now()).toBe(1_000_000);
  });

  it("new Date() reflects the fake clock", () => {
    mock.useFakeTimers({ now: new Date("2024-01-01T00:00:00Z") });
    expect(new Date().toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("new Date(args) still constructs from the arguments", () => {
    mock.useFakeTimers({ now: 0 });
    const d = new Date("2024-06-15T12:00:00Z");
    expect(d.toISOString()).toBe("2024-06-15T12:00:00.000Z");
  });

  it("instanceof Date works on fake instances", () => {
    mock.useFakeTimers();
    const d = new Date();
    expect(d instanceof Date).toBe(true);
  });

  it("Date.parse and Date.UTC still work", () => {
    mock.useFakeTimers();
    expect(typeof Date.parse("2024-01-01")).toBe("number");
    expect(typeof Date.UTC(2024, 0, 1)).toBe("number");
  });
});

describe("mock.setSystemTime / getRealSystemTime", () => {
  it("setSystemTime jumps the clock without firing intermediate timers", () => {
    mock.useFakeTimers({ now: 0 });
    const fn = spy();
    setTimeout(fn, 5_000);

    mock.setSystemTime(10_000);
    expect(Date.now()).toBe(10_000);
    expect(fn.mock.calls).toEqual([]); // jumped past, but didn't fire anything
  });

  it("setSystemTime accepts Date, ISO string, or epoch number", () => {
    mock.useFakeTimers();

    mock.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    expect(Date.now()).toBe(1_704_067_200_000);

    mock.setSystemTime("2024-06-15T00:00:00Z");
    expect(Date.now()).toBe(1_718_409_600_000);

    mock.setSystemTime(0);
    expect(Date.now()).toBe(0);
  });

  it("getRealSystemTime returns the actual system time", () => {
    mock.useFakeTimers({ now: 0 });

    const before = mock.getRealSystemTime();
    expect(Math.abs(before - new Date().getTime())).toBeGreaterThan(
      1_000_000_000_000,
    );
    // The fake clock is at 0 but the real clock is now-ish.
    expect(before).toBeGreaterThan(1_700_000_000_000);
  });

  it("subsequent timers schedule against the new now", () => {
    mock.useFakeTimers({ now: 0 });
    const fn = spy();
    mock.setSystemTime(1_000_000);
    setTimeout(fn, 100);

    mock.advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(1);
    expect(Date.now()).toBe(1_000_100);
  });
});

describe("mock — performance.now", () => {
  it("returns the fake clock value", () => {
    mock.useFakeTimers({ now: 5_000 });
    expect(performance.now()).toBe(5_000);

    mock.advanceTimersByTime(250);
    expect(performance.now()).toBe(5_250);
  });
});
