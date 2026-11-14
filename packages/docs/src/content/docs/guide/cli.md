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
| `-w, --watch` | Re-run tests automatically when files change |
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

# Watch mode - re-run on file changes
unrift --watch

# Use a specific config file
unrift --config ./test/custom.config.ts

# List test files without running them
unrift --list

# JSON output for CI pipelines
unrift --json
```

## Filtering by test name

`--grep` matches against the full test name, which is the file path, the describe blocks and the test name joined with ` › `. So `unrift --grep "math › adds"` runs `adds numbers` inside `describe("math")`.

Tests that don't match show up as skipped so the totals stay the same. Hooks for a describe block only run if something inside it matches.

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
  "results": [
    {
      "description": "math > adds numbers",
      "status": "pass",
      "durationMs": 1.2
    }
  ]
}
```

When `--json` is active, debug output goes to stderr to keep stdout clean.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| `1` | One or more tests failed, or no test files found |

## Cache management

Unrift caches esbuild bundles in `node_modules/.unrift/cache` to speed up subsequent runs.

```bash
# Clear the cache
unrift --cache-clean
```
