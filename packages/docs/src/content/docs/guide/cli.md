---
title: CLI
description: Command-line interface reference for Unrift.
---

## Usage

```bash
unrift [pattern] [options]
```

The first positional argument is a regex pattern to filter test files by path.

## Flags

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file |
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

# Stop on first failure with a 10s timeout
unrift --bail --timeout 10000

# Watch mode — re-run on file changes
unrift --watch

# Use a specific config file
unrift --config ./test/custom.config.ts

# List test files without running them
unrift --list

# JSON output for CI pipelines
unrift --json
```

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
