---
title: Module Mocking
description: Replace external module imports with test doubles via mock.doMock.
---

Module mocking lets you replace an imported module with a test double for the duration of a test. Unrift ships this feature in **tiers** - Tier A is shipped today and covers the most common case. Tiers B, C, and D are planned. This page is explicit about what each tier covers so you can plan around the current limits.

## Status - Tier A (shipped)

Tier A handles dynamic imports of external module specifiers. That covers Node built-ins (`node:fs`, `node:path`, `node:crypto`, …) and bare package names (`react`, `lodash`, `axios`, …). It's the primary use case for "swap out an external dependency in tests."

```ts
import { mock } from "unrift";

mock.doMock("node:os", () => ({
  platform: () => "linux-mocked",
  arch: () => "x64-mocked",
}));

const os = await import("node:os");
os.platform(); // → "linux-mocked"
```

## Supported now

The following work in Tier A:

| Capability | Notes |
| --- | --- |
| `mock.doMock(spec, factory)` | Register a mock for `spec`. |
| `mock.unmock(spec)` | Remove a previously registered mock. |
| `mock.restoreAll()` | Restores every active mock (spies, stubs, fetch, timers, **and modules**). |
| `mock.listMockedSpecs()` | Returns the current set of mocked specs, for debugging. |
| **Dynamic** imports - `await import(spec)` | The mock takes effect when the import happens. |
| External specifiers | Bare package names (`react`) and `node:*` built-ins. |
| Named exports | Any factory-returned key that is a valid JS identifier becomes a named export. |
| `default` export | The factory's `default` property becomes the module's default export. |
| Re-mocking the same spec | A monotonic registration ID is embedded in the synthetic URL so each `doMock` produces a fresh module - even if the spec was mocked earlier in the same test run. |

## Not supported yet

These limits are intentional in Tier A - each is addressed by a future tier. Hitting one of these is not a bug; it's the current scope.

| Limit | What to do today | Tier that unlocks it |
| --- | --- | --- |
| **Static** imports - `import { x } from "spec"` will see the real module. ESM hoists static imports above the test body, so `mock.doMock(...)` runs too late. | Use `await import(spec)` in the test. | Tier B (hoisted `mock.module`) |
| **Relative** specifiers - `mock.doMock("./bar", ...)` does not work. Relative imports are bundled inline by esbuild before runtime, leaving nothing to intercept. | Refactor the dependency into a package (`@your-org/...`) or `node:*` built-in, or wrap the relative file behind an external barrel. | Tier C (relative-path mocking) |
| **Closure-aware factories** - factory bodies referencing variables from the enclosing scope are not yet rewritten for hoisted use. (They work fine in Tier A because doMock isn't hoisted, but Tier B will require self-contained factories or explicit marking.) | n/a in Tier A; relevant only when Tier B lands. | Tier D |
| **Per-test factory rerun** - the factory is invoked **once** at registration time. Re-importing the spec returns the same result. | If you need fresh values per import, swap to `mock.fn()` returns or call `doMock` again. | n/a - design choice |
| **`mock.module(spec, factory)`** as a hoisted alias - not exposed yet to avoid teaching users an API that doesn't fully hoist. | Use `mock.doMock` (the Jest/Vitest naming convention for the non-hoisted variant). | Tier B |
| **CJS interop edge cases** - modules whose default export needs `__esModule` interop tagging may not round-trip cleanly. | Stick to ESM-style factories: `{ default: ..., named: ... }`. | Tier B+ |

## Whole-module auto-mock

`mock.fromModule(spec)` is a convenience helper that imports the real module, wraps every function-export in a spy, registers the result via `mock.doMock`, and returns the mocked exports. Non-function exports are passed through unchanged. Useful for "I want everything mocked, but I'll customize a few methods."

```ts
const path = await mock.fromModule<typeof import("node:path")>("node:path");

// All functions are spies by default - calls record but return undefined.
path.join.mockReturnValue("/fake/joined/path");

// Subsequent dynamic imports get the mocked module.
const fresh = await import("node:path");
fresh.join("a", "b"); // → "/fake/joined/path"

// Non-function exports like `sep` and `delimiter` pass through unchanged.
expect(typeof fresh.sep).toBe("string");
```

Inherits the same Tier A limits - only affects `await import(spec)` after the call.

## Workarounds for the static-import limit

The most common adjustment is converting a static import to dynamic for the spec you want to mock. Other imports in the test file can stay static.

```ts
// ❌ Won't be mocked - static import runs before mock.doMock()
import { readFileSync } from "node:fs";

// ✅ Will be mocked - dynamic import resolves after mock.doMock()
mock.doMock("node:fs", () => ({
  readFileSync: () => "MOCK CONTENT",
}));
const { readFileSync } = await import("node:fs");
```

If the code under test uses static imports, refactor the test to invoke the code through a wrapper that does `await import()` internally - or wait for Tier B.

## Restoration

`mock.doMock` registers itself with the same bulk-restore registry as `spyOn`, `stub`, `useFakeTimers`, and `mock.fetch`. So `mock.restoreAll()` cleans up every module mock at once. The idiomatic pattern is `afterEach`:

```ts
import { afterEach, mock } from "unrift";

afterEach(() => {
  mock.restoreAll();
});
```

## How it works (for future maintainers)

A short tour, since the implementation crosses thread boundaries:

1. **The CLI** (`src/cli.ts`) calls `registerModuleLoader()` (from `src/mock/register-loader.ts`) once at startup, before any test file is imported. That helper does the `module.register("./module-loader.js", ...)`. Registration lives in the shared CLI — not the bins — so both the `@unrift/core` bin and the `unrift` wrapper bin are thin entrypoints that get module mocking for free by running the same CLI. This needs Node 18.19+ / 20.6+ - older Node falls back gracefully (no mocking, but the rest of unrift still works).
2. `module.register()` creates a worker thread for the loader. A `MessagePort` is passed in so the main thread can talk to it.
3. The main-side port is stashed on `globalThis.__unriftLoaderPort` so `mock.doMock` can reach it without circular imports.
4. When `mock.doMock(spec, factory)` runs:
   - It invokes the factory once.
   - The result is cached on `globalThis.__unriftMocks` (a `Map`).
   - A `register` message - including the spec, a per-registration ID, and the export keys - is posted to the loader.
5. The loader uses `worker_threads.receiveMessageOnPort` synchronously at the top of every `resolve()` hook to drain any pending registrations into its local map.
6. When the test does `await import("node:os")`, the loader's `resolve()` sees a match and returns `unrift-mock:node:os?v=<id>`. The `?v=<id>` defeats Node's URL-keyed module cache so a later re-mock of the same spec produces a fresh module.
7. The loader's `load()` hook emits synthetic ESM source like:
   ```js
   const __mocks = globalThis.__unriftMocks;
   const __exports = __mocks.get("node:os");
   export const platform = __exports["platform"];
   export default __exports.default;
   ```
   This source runs in the **main thread**, where `globalThis.__unriftMocks` actually lives.

The IPC contract is intentionally extensible: Tier B will add `register-hoisted` and Tier C will add `register-relative` message types without breaking Tier A consumers.

## Roadmap

See the [ISSUES.md tracking epic](https://github.com/ElijahKotyluk/unrift/blob/main/ISSUES.md) for issue links. Briefly:

- **Tier B - hoisted `mock.module(spec, factory)` for static imports.** Requires an AST hoisting pass (likely [acorn](https://github.com/acornjs/acorn)) and a small esbuild plugin integration in the test transform pipeline.
- **Tier C - relative-path mocking.** Requires marking detected relative specs as external in the bundle, plus a virtual-module generator path through esbuild.
- **Tier D - closure-aware factories, CJS interop polish, edge-case coverage.** Plus a stability sweep across circular imports, re-exports, and `import.meta`.

Each tier extends the existing registry and IPC protocol rather than replacing them.
