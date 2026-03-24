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
  includes: ["\\.spec\\.ts$"],
  excludes: ["node_modules"],
});
```

Unrift searches for config files in this order:
- `unrift.config.ts`
- `unrift.config.js`
- `unrift.config.mjs`
- `unrift.config.cjs`
- `unrift.config.json`

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `testDir` | `string` | `"test"` | Directory to search for test files (relative to config file) |
| `rootDir` | `string` | — | Project root directory |
| `timeoutMs` | `number` | — | Default timeout for each test in milliseconds |
| `bail` | `boolean` | `false` | Stop running tests after the first failure |
| `pattern` | `string` | — | Regex pattern to filter test files |
| `includes` | `string[]` | — | Regex patterns — only matching files are included |
| `excludes` | `string[]` | — | Regex patterns — matching files are excluded |
| `matchers` | `string[]` | — | Module specifiers for custom matcher packages |

## Test file discovery

Unrift recursively scans `testDir` for files matching these patterns:

- `*.spec.ts` / `*.test.ts`
- `*.spec.js` / `*.test.js`
- `*.spec.mts` / `*.test.mts`
- `*.spec.tsx` / `*.test.tsx`
- And other TypeScript/JavaScript extensions

## Includes and excludes

Both `includes` and `excludes` accept an array of regex pattern strings. They are tested against both the relative path (from `testDir`) and the absolute path.

```ts
export default defineConfig({
  testDir: "test",
  includes: ["\\.spec\\.ts$"],          // only .spec.ts files
  excludes: ["integration", "fixtures"], // skip these directories
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

## CLI overrides

CLI flags override config file values:

```bash
unrift --bail --timeout 10000 --config ./custom.config.ts
```

See the [CLI reference](/guide/cli/) for all flags.
