---
title: Configuration
description: Configure Unrift with a config file.
---

Unrift works with zero configuration. When you need to customize behavior, create a config file in your project root.

## Config file

Create `unrift.config.ts`:

```ts
import { defineConfig } from "unrift";

export default defineConfig({
  testDir: "test",
  timeoutMs: 5000,
  bail: false,
  includes: ["**/*.spec.ts"],
  excludes: ["**/fixtures/**"],
});
```

Unrift searches upward from your project root for a config file named `unrift.config.*` with any of these extensions: `.ts`, `.js`, `.mjs`, `.cjs`, `.json`.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `testDir` | `string` | `"test"` | Directory to search for test files (relative to config file) |
| `timeoutMs` | `number` | - | Default timeout for each test in milliseconds |
| `bail` | `boolean` | `false` | Stop running tests after the first failure |
| `workers` | `number` | `1` | Run test files in this many worker threads, see [Workers](/guide/cli/#workers) |
| `retries` | `number` | `0` | Retry failing tests this many times. Can be overridden per test |
| `pattern` | `string` | - | Regex pattern to filter test files by path |
| `includes` | `string[]` | - | Glob or regex patterns - only matching files are included |
| `excludes` | `string[]` | - | Glob or regex patterns - matching files are excluded |
| `matchers` | `string[]` | - | Module specifiers for custom matcher packages |
| `coverage` | `object` | - | Coverage settings, see [Coverage](/guide/coverage/#config) |

## Test file discovery

Unrift recursively scans `testDir` for files matching these patterns:

- `*.spec.ts` / `*.test.ts`
- `*.spec.js` / `*.test.js`
- `*.spec.mts` / `*.test.mts`
- `*.spec.cts` / `*.test.cts`
- `*.spec.tsx` / `*.test.tsx`
- `*.spec.jsx` / `*.test.jsx`
- `*.spec.mjs` / `*.test.mjs`
- `*.spec.cjs` / `*.test.cjs`

## Includes and excludes

Both `includes` and `excludes` accept glob patterns or regex strings. Patterns containing `*`, `?`, `[`, or `{` are treated as globs; everything else is treated as a raw regex for backward compatibility.

```ts
export default defineConfig({
  testDir: "test",
  includes: ["**/*.spec.ts"],             // glob - only .spec.ts files
  excludes: ["**/fixtures/**", "e2e/**"], // glob - skip these directories
});
```

Regex strings still work if you need them:

```ts
export default defineConfig({
  excludes: ["\\.fixture\\.ts$"], // regex - exclude .fixture.ts files
});
```

## Custom matchers via config

Register matcher packages that are loaded before tests run:

```ts
export default defineConfig({
  matchers: ["my-custom-matchers"],
});
```

The module should call `expect.extend()` when imported.

Hooks it adds at the top level are every test file's, like a setup file in Jest (`setupFilesAfterEnv`) or Vitest (`setupFiles`). `beforeAll` and `afterAll` run around each file that has a test to run, after the file is loaded. `beforeEach` and `afterEach` run around each test.

The module is loaded again for each test file, before it, so what it keeps at its top level starts fresh in every file, with workers or without. A test file that imports it gets that same copy, its hooks run once. Code a test file needs when it loads goes at the module's top level, not in a `beforeAll`. A relative path is from the config's folder.

## CLI overrides

CLI flags override config file values:

```bash
unrift --bail --timeout 10000 --config ./custom.config.ts
```

See the [CLI reference](/guide/cli/) for all flags.
