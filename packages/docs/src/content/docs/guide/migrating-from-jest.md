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
+   includes: ["\\.spec\\.ts$"],
+ });
```

## CLI changes

| Jest | Unrift | Notes |
|------|--------|-------|
| `jest` | `unrift` | Run all tests |
| `jest --bail` | `unrift --bail` | Same flag |
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
| `toMatchObject` | — | Not yet supported |
| `toMatchSnapshot` | — | Not yet supported |
| `toMatchInlineSnapshot` | — | Not yet supported |
| `toHaveBeenCalled` | — | No built-in mocking |
| `toHaveProperty` | — | Not yet supported |

## Not yet supported

These Jest features are planned but not yet available:

- **Snapshot testing** — `toMatchSnapshot`, `toMatchInlineSnapshot`
- **Mocking** — `jest.fn()`, `jest.mock()`, `jest.spyOn()`
- **Coverage** — `--coverage` flag
- **Watch mode** — `--watch` flag
- **Parallel execution** — tests run sequentially
- **Custom reporters** — only built-in pretty and JSON output
- **Browser/DOM environment** — Node.js only

For mocking, you can use standalone libraries like [tinyspy](https://github.com/tinylibs/tinyspy) alongside Unrift.
