---
title: CLI
description: Command-line interface reference for Unrift.
---

## Usage

```bash
unrift [pattern] [options]
```

The first positional argument is a regex pattern to filter test files by path. Use `--grep` to filter by test name instead.

## Flags

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file |
| `-g, --grep <pattern>` | Only run tests whose full name matches the regex |
| `-b, --bail` | Stop on first test failure |
| `-t, --timeout <ms>` | Default test timeout in milliseconds |
| `--workers <n>` | Run test files in `n` worker threads, see [Workers](#workers) |
| `-w, --watch` | Re-run tests automatically when files change |
| `-u, --update-snapshots` | Rewrite snapshots that don't match and remove obsolete ones |
| `--coverage` | Report code coverage, see [Coverage](/guide/coverage/) |
| `--coverage-reporter <name>` | `text`, `lcov` or `json`. Repeat or comma-separate for more than one, turns coverage on |
| `-d, --debug` | Enable debug logging |
| `-l, --list` | List discovered test files without running them |
| `-j, --json` | Output results as JSON |
| `--cache-clean, --clear-cache` | Clear the esbuild transform cache |
| `-v, --version` | Show version |
| `-h, --help` | Show help |

## Examples

```bash
# Run all tests
unrift

# Run tests matching a pattern
unrift math

# Run tests by name
unrift --grep "adds numbers"

# Stop on first failure with a 10s timeout
unrift --bail --timeout 10000

# Run files in 4 worker threads
unrift --workers 4

# Watch mode - re-run on file changes
unrift --watch

# Update snapshots
unrift -u

# Coverage, with an lcov file for CI
unrift --coverage --coverage-reporter text,lcov

# Use a specific config file
unrift --config ./test/custom.config.ts

# List test files without running them
unrift --list

# JSON output for CI pipelines
unrift --json
```

## Filtering by test name

`--grep` matches against the full test name, which is the file path, the describe blocks and the test name joined with ` › `. So `unrift --grep "math › adds"` runs `adds numbers` inside `describe("math")`.

Tests that don't match show up as skipped so the totals stay the same, and a matching `it.todo` still shows as todo. Hooks for a describe block only run if a matching test inside it actually runs.

## Watch mode

`--watch` reruns when anything in the test dir changes, or a file a TypeScript test or config imports, like your source files. A new import is watched from the run that first loads it.

Files imported only by `.js` test files or a `.js` config aren't watched, Node loads those without bundling.

## Workers

`--workers <n>` runs test files in `n` worker threads at once. Each worker takes the next file when it's done with one, and the results are reported in file order like a run without workers.

What a file writes to stdout and stderr is held until the file is done, then printed in file order. Output from two files never mixes, but it shows up once the file finishes, not as it's written. A timer that writes after the file's tests is still that file's output, until the run ends: once every file is done the workers stop, and later output or errors are lost. If a worker stops early, what its files wrote is still printed.

Inline snapshots are written once every worker is done, so a helper that files in different workers call gets one write. Different values at the same `toMatchInlineSnapshot()` from files in different workers fail every test that ran it, and count as failed snapshots. Without workers only the later one fails, with workers there's no telling which ran first.

A worker has its own modules, globals, mocks and copy of `process.env`, files in different workers don't share them. Files in the same worker run one after another, like they do without workers.

Things that work differently in a worker:

- `process.chdir()` throws, the working directory is the process's
- `process.exit()` in a test, or an error thrown from a timer, stops its worker. The file it was running fails, or the last one it ran, and a new worker takes the rest. Coverage of what the stopped worker ran is lost, the run fails anyway
- `process.exitCode` set by a test doesn't reach the run's exit code
- stdout and stderr aren't a terminal, so libraries that check for one print without colors
- `beforeAll` and `afterAll` that a `matchers` module adds at the top level run once in each worker
- Files on disk are shared, two files writing the same path can collide
- Only `process.stdout` and `process.stderr` are held per file. A child process started with `stdio: "inherit"`, or a write straight to file descriptor 1 or 2, goes out right away and can mix with another file's output

`--bail` stops the other workers too. Tests they already started finish, the rest are skipped.

## JSON output

The `--json` flag outputs a structured report to stdout:

```json
{
  "ok": true,
  "passed": 5,
  "failed": 0,
  "skipped": 1,
  "todo": 0,
  "total": 6,
  "bail": false,
  "timeoutMs": 5000,
  "testDir": "test",
  "configPath": "/path/to/unrift.config.ts",
  "durationMs": 142.5,
  "files": ["test/math.spec.ts"],
  "snapshots": {
    "added": 0,
    "updated": 0,
    "failed": 0,
    "obsolete": 0,
    "removed": 0,
    "obsoleteKeys": [],
    "filesWritten": [],
    "inlineSkipped": [],
    "errors": []
  },
  "results": [
    {
      "description": "math > adds numbers",
      "status": "pass",
      "durationMs": 1.2
    }
  ]
}
```

With coverage on, the report also has a `coverage` block: `total` and per-file `files` with `lines`, `functions` and `branches` (`covered`, `total`, `pct`) and `uncoveredLines`, threshold `failures`, and the `reports` files written.

When `--json` is active, debug output goes to stderr to keep stdout clean.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| `1` | One or more tests failed, there are obsolete snapshots, coverage is under a threshold, or no test files found |

## Cache management

Unrift caches esbuild bundles in `node_modules/.unrift/cache` to speed up subsequent runs.

```bash
# Clear the cache
unrift --cache-clean
```
