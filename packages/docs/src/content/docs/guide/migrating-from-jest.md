---
title: Migrating from Jest
description: Switch from Jest to Unrift.
---

Unrift's API is designed to be familiar to Jest and Vitest users. Most tests can be migrated with minimal changes.

## What stays the same

These work identically in Unrift:

- `describe()`, `it()`, `test()`
- `expect()` with `.toBe()`, `.toEqual()`, `.toThrow()`, etc.
- `.not` chaining
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach`
- `.only`, `.skip`
- Async test functions

## Import changes

The main difference is explicit imports. Unrift doesn't inject globals:

```diff
- // Jest: globals are available automatically
- describe("math", () => {
+ import { describe, it, expect } from "unrift";
+
+ describe("math", () => {
    it("adds", () => {
      expect(1 + 1).toBe(2);
    });
  });
```

## Config changes

```diff
- // jest.config.ts
- export default {
-   testMatch: ["**/*.spec.ts"],
-   transform: { "^.+\\.tsx?$": "ts-jest" },
- };

+ // unrift.config.ts
+ import { defineConfig } from "unrift";
+
+ export default defineConfig({
+   testDir: "test",
+   includes: ["**/*.spec.ts"],
+ });
```

## CLI changes

| Jest | Unrift | Notes |
|------|--------|-------|
| `jest` | `unrift` | Run all tests |
| `jest --bail` | `unrift --bail` | Same flag |
| `jest --watch` | `unrift --watch` | Watch mode |
| `jest --json` | `unrift --json` | Similar output |
| `jest math` | `unrift math` | Pattern filter |
| `jest --config path` | `unrift --config path` | Same concept |
| `jest --testTimeout 5000` | `unrift --timeout 5000` | Different flag name |

## Matcher differences

Most matchers are identical. Key differences:

| Jest | Unrift | Status |
|------|--------|--------|
| `toBe` | `toBe` | Same (`Object.is`) |
| `toEqual` | `toEqual` | Same (deep, prototype-insensitive) |
| `toStrictEqual` | `toStrictEqual` | Same (deep, prototype-sensitive) |
| `toMatchObject` | `toMatchObject` | Same (partial recursive match) |
| `toHaveProperty` | `toHaveProperty` | Same (dot-notation and array paths supported) |
| `toHaveBeenCalled` | `toHaveBeenCalled` | Same |
| `toHaveBeenCalledTimes(n)` | `toHaveBeenCalledTimes(n)` | Same |
| `toHaveBeenCalledWith(...)` | `toHaveBeenCalledWith(...)` | Same |
| `toHaveBeenLastCalledWith(...)` | `toHaveBeenLastCalledWith(...)` | Same |
| `toHaveBeenNthCalledWith(n, ...)` | `toHaveBeenNthCalledWith(n, ...)` | Same |
| `toHaveReturned` / `toHaveReturnedWith(v)` | Same | Same |
| `toHaveReturnedTimes(n)` | `toHaveReturnedTimes(n)` | Same |
| `toHaveLastReturnedWith(v)` | `toHaveLastReturnedWith(v)` | Same |
| `toHaveNthReturnedWith(n, v)` | `toHaveNthReturnedWith(n, v)` | Same |
| (no equivalent - manual `expect(spy).toHaveBeenCalled()` on fetch wrapper) | `expect(mock.fetch).toHaveFetched(url)` | Convenience matcher unique to unrift |
| (no equivalent) | `expect(mock.fetch).toHaveFetchedTimes(n)` | Convenience matcher unique to unrift |
| `toMatchSnapshot` | - | Not yet supported |
| `toMatchInlineSnapshot` | - | Not yet supported |

## Mocking

Unrift ships a built-in mocking suite. Drop the `jest.` prefix:

| Jest | Unrift |
|------|--------|
| `jest.fn()` | `mock.fn()` (or `spy()`) |
| `jest.fn(impl)` | `mock.fn(impl)` |
| `jest.spyOn(obj, "method")` | `mock.spyOn(obj, "method")` (or `spyOn`) |
| `jest.useFakeTimers()` | `mock.useFakeTimers()` |
| `jest.useFakeTimers({ doNotFake: [...] })` | `mock.useFakeTimers({ doNotFake: [...] })` |
| `jest.useFakeTimers({ toFake: [...] })` | `mock.useFakeTimers({ toFake: [...] })` |
| `jest.advanceTimersByTime(ms)` | `mock.advanceTimersByTime(ms)` |
| `jest.advanceTimersByTimeAsync(ms)` | `mock.advanceTimersByTimeAsync(ms)` |
| `jest.runAllTimers()` | `mock.runAllTimers()` |
| `jest.runAllTimersAsync()` | `mock.runAllTimersAsync()` |
| `jest.runOnlyPendingTimers()` | `mock.runOnlyPendingTimers()` |
| `jest.runOnlyPendingTimersAsync()` | `mock.runOnlyPendingTimersAsync()` |
| `jest.setSystemTime(date)` | `mock.setSystemTime(date)` |
| `jest.useRealTimers()` | `mock.useRealTimers()` |
| `jest.clearAllMocks()` | `mock.clearAll()` |
| `jest.resetAllMocks()` | `mock.resetAll()` |
| `jest.restoreAllMocks()` | `mock.restoreAll()` |
| `jest.mock("path", factory)` | `mock.doMock("path", factory)` (Tier A - see below) |
| `jest.createMockFromModule("path")` | `await mock.fromModule("path")` |
| `jest.spyOn(obj, "prop", "get")` | `mock.spyOn(obj, "prop", "get")` |
| `jest.spyOn(obj, "prop", "set")` | `mock.spyOn(obj, "prop", "set")` |

The full mock API is documented in [Spies and Mocks](../../reference/spies-and-mocks), with dedicated pages for [Request Mocking](../../reference/request-mocking), [Timers and Dates](../../reference/timers-and-dates), and [Module Mocking](../../reference/module-mocking).

### Module mocking is partial

Module mocking ships in tiers. Tier A - currently shipped - handles **dynamic** imports (`await import(spec)`) of **external** specifiers only (bare package names, `node:*` built-ins). Static `import` statements and relative paths are not yet intercepted.

```diff
- // Jest - hoisted, works with static imports
- jest.mock("./userService", () => ({
-   getUser: jest.fn().mockReturnValue({ id: 1 }),
- }));
- import { getUser } from "./userService";

+ // Unrift Tier A - dynamic import only
+ mock.doMock("node:fs", () => ({
+   readFileSync: () => "MOCK CONTENT",
+ }));
+ const fs = await import("node:fs");
```

The hoisted `mock.module` API for static imports is on the roadmap (Tier B). See the [Module Mocking reference](../../reference/module-mocking) for the full list of current limits and workarounds.

## Not yet supported

These Jest features are planned but not yet available:

- **Snapshot testing** - `toMatchSnapshot`, `toMatchInlineSnapshot`
- **Hoisted `jest.mock`** for static imports - `mock.doMock` covers dynamic imports today; the hoisted variant is planned (Tier B)
- **Coverage** - `--coverage` flag
- **Parallel execution** - tests run sequentially
- **Custom reporters** - only built-in pretty and JSON output
- **Browser/DOM environment** - Node.js only
