---
title: Modifiers
description: Control which tests run with .only, .skip, and .todo.
---

Modifiers let you focus on specific tests, skip others, or mark tests as planned but not yet implemented.

## .only

Run only the marked tests or suites. All other tests are skipped.

```ts
describe.only("focused suite", () => {
  it("this runs", () => {
    expect(true).toBe(true);
  });
});

describe("other suite", () => {
  it("this is skipped", () => { /* ... */ });
});
```

Works on individual tests too:

```ts
describe("math", () => {
  it.only("this runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("this is skipped", () => { /* ... */ });
});
```

Multiple `.only` markers can coexist - all marked tests run, everything else is skipped.

:::caution
Remember to remove `.only` before committing. Tests marked with `.only` will cause other tests to be silently skipped.
:::

## .skip

Skip a test or suite entirely. Skipped tests appear in the output but don't run.

```ts
describe.skip("broken feature", () => {
  it("doesn't run", () => { /* ... */ });
});

it.skip("temporarily disabled", () => { /* ... */ });
```

## .todo

Mark a test as planned but not yet implemented. No test function is needed:

```ts
it.todo("should validate email format");
it.todo("should handle edge case with empty input");
describe.todo("upcoming feature");
```

Todo tests appear in the output with a distinct indicator and don't count as failures.

## Per-test timeout

Pass a timeout in milliseconds as the third argument to `it()` or `test()` to override the global timeout for a specific test:

```ts
it("slow integration call", async () => {
  await fetch("https://example.com/api");
}, 30_000); // 30 second timeout for this test only
```

The per-test timeout takes precedence over the global `timeoutMs` config option and the `--timeout` CLI flag.

You can also pass an options object instead of a number:

```ts
it("slow integration call", async () => {
  await fetch("https://example.com/api");
}, { timeout: 30_000, retries: 2 });
```

## Retries

Use `retries` for flaky tests. A failing test runs again up to that many times and passes if any attempt passes. `beforeEach` and `afterEach` run for every attempt.

```ts
it("flaky network call", async () => {
  await fetchSomething();
}, { retries: 3 });
```

Set `retries` in the config to apply it to every test. A per-test value wins, so `{ retries: 0 }` turns it off for one test.

Retried tests show the attempt count in the output, e.g. `✘ flaky network call (failed after 4 attempts)`. In `--json` output they get an `attempts` field.

## CLI output

Each status has a distinct indicator in the CLI output:

| Status | Symbol | Color |
|--------|--------|-------|
| Pass | `✔` | Green |
| Fail | `✘` | Red |
| Skip | `↷` | Yellow |
| Todo | `○` | Magenta |
