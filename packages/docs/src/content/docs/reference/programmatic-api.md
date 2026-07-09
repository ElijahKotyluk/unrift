---
title: Programmatic API
description: Run Unrift programmatically from your own scripts.
---

Unrift exposes a programmatic API for running tests from scripts, CI tools, or custom integrations.

## runEngine

The main entry point is `runEngine` from `unrift/run`:

```ts
import { runEngine } from "unrift/run";

const result = await runEngine({
  files: ["test/math.spec.ts", "test/string.spec.ts"],
  timeoutMs: 5000,
  bail: false,
});

console.log(`Passed: ${result.results.filter(r => r.status === "pass").length}`);
console.log(`Failed: ${result.results.filter(r => r.status === "fail").length}`);
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `files` | `string[]` | - | **Required.** Absolute or relative paths to test files |
| `timeoutMs` | `number` | - | Timeout per test in milliseconds |
| `bail` | `boolean` | `false` | Stop after first failure |
| `matchers` | `string[]` | - | Module specifiers for custom matchers to load |

## Return value

`runEngine` returns a `RunEngineResult`:

```ts
type RunEngineResult = {
  isOnly: boolean;       // true if any .only was active
  timeoutMs?: number;    // timeout used
  bail: boolean;         // bail mode
  results: Array<{
    description: string; // full test name (suite > test)
    status: TaskStatus;  // "pass" | "fail" | "skipped" | "todo"
    error?: Error;       // error details if failed
    durationMs: number;  // execution time in ms
  }>;
};
```

:::note
The `status` field uses the internal `TaskStatus` enum. In practice, results will only contain `"pass"`, `"fail"`, `"skipped"`, or `"todo"`.
:::

## Example: CI script

```ts
import { runEngine } from "unrift/run";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Discover test files in the test directory
const testDir = "./test";
const files = readdirSync(testDir, { recursive: true })
  .filter(f => /\.(spec|test)\.(ts|js|mts|tsx)$/.test(String(f)))
  .map(f => join(testDir, String(f)));

const { results } = await runEngine({ files, timeoutMs: 10000 });

const failed = results.filter(r => r.status === "fail");

if (failed.length > 0) {
  console.error(`${failed.length} test(s) failed:`);
  for (const f of failed) {
    console.error(`  - ${f.description}: ${f.error?.message}`);
  }
  process.exit(1);
}

console.log(`All ${results.length} tests passed.`);
```
