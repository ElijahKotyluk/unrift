---
title: Coverage
description: See which lines, functions and branches your tests ran.
---

Run with `--coverage` to see which code your tests ran:

```bash
unrift --coverage
```

```
──────────────────────── COVERAGE ────────────────────────

  File            Lines   Functions   Branches   Uncovered lines
  src/math.ts    57.14%      66.66%      0.00%   12-13, 16-19
  src/user.ts   100.00%     100.00%    100.00%
  All files      78.57%      80.00%     50.00%
```

It uses the coverage V8 already collects, so there's nothing to install and your code isn't rewritten. TypeScript is mapped back to the lines you wrote.

## Config

```ts
import { defineConfig } from "unrift";

export default defineConfig({
  coverage: {
    enabled: true,
    include: ["src/**"],
    exclude: ["src/generated/**"],
    reporter: ["text", "lcov"],
    reportsDirectory: "coverage",
    thresholds: { lines: 80, functions: 80, branches: 70 },
  },
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Same as `--coverage` |
| `include` | - | Only report files matching one of these |
| `exclude` | - | Don't report files matching one of these |
| `reporter` | `"text"` | `"text"`, `"lcov"` or `"json"`, or a list of them |
| `reportsDirectory` | `"coverage"` | Where `lcov` and `json` write their files |
| `thresholds` | - | Fail the run when `lines`, `functions` or `branches` is under this percentage |

`include` and `exclude` take globs or regexes like the test [`includes` and `excludes`](/guide/configuration/#includes-and-excludes), relative to the config file.

## What's reported

Only files the tests loaded. A file no test imports doesn't show up, it isn't listed at 0%.

Test files, `node_modules` and files outside the config file's folder are never reported.

## Reporters

- `text` prints the table above.
- `lcov` writes `lcov.info`, which Codecov, Coveralls and most editors read.
- `json` writes `coverage-summary.json`, laid out like Istanbul's `json-summary`.

On the CLI, `--coverage-reporter` picks them and turns coverage on. Repeat it or separate with commas:

```bash
unrift --coverage-reporter text,lcov
```

There's no HTML report, `genhtml coverage/lcov.info` makes one from the lcov file.

## Thresholds

When a percentage is under its threshold the run fails and says which:

```
 ✘ Coverage for lines (57.14%) is below the 80% threshold
```

## Branches

Branches come from V8's block coverage, same as c8 and Vitest's `v8` provider. V8 only lists a block that ran a different number of times than the code around it. So an `if` that always went the same way shows up as one branch that never ran, not as one of two that did, and the branch percentage reads lower than Istanbul's would.

Lines and functions don't have this, they're exact.

## Watch mode

`--watch --coverage` reports each run on its own, counts start from zero every time.
