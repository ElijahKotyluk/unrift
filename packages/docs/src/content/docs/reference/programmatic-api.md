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
| `grep` | `RegExp` | - | Only run tests whose full name matches |
| `retries` | `number` | `0` | Retry failing tests this many times |
| `matchers` | `string[]` | - | Module specifiers for custom matchers to load |
| `updateSnapshots` | `"all" \| "new" \| "none"` | `"none"` on CI, otherwise `"new"` | `"all"` is `-u`, `"new"` writes new snapshots only, `"none"` writes nothing |
| `coverage` | `boolean \| { root?, include?, exclude? }` | - | Collect coverage. Files outside `root` (default: the working directory) aren't reported |

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
    attempts?: number;   // how many times it ran, above 1 means retried
  }>;
  snapshots: {
    added: number;       // new snapshots written
    updated: number;     // mismatches overwritten ("all" only)
    failed: number;      // didn't match, or not written on CI
    obsolete: number;    // stored but no test used them
    removed: number;     // obsolete ones deleted ("all" only)
    obsoleteKeys: Array<{ file: string; key: string }>; // obsolete ones still in their .snap file
    filesWritten: string[];  // .snap files, and test files with inline snapshots written
    inlineSkipped: string[]; // test files that changed during the run, inline snapshots not written
    errors: Array<{ file: string; message: string }>; // files that couldn't be read or written, these fail the run
  };
  coverage?: {           // set when coverage was asked for
    files: Array<{
      file: string;                       // absolute path
      lines: Record<number, number>;      // line to times it ran, only lines with code
      functions: Array<{ name: string; line: number; count: number }>;
      branches: Array<{ line: number; count: number }>;
    }>;
    summary: {
      total: { lines: Metric; functions: Metric; branches: Metric };
      files: Array<{ file: string; lines: Metric; functions: Metric; branches: Metric; uncoveredLines: number[] }>;
    };
  };
};

type Metric = { covered: number; total: number; pct: number };
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
