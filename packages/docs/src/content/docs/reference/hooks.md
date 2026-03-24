---
title: Hooks
description: Set up and tear down test state with lifecycle hooks.
---

Hooks let you run setup and teardown code at different points in the test lifecycle.

## Available hooks

| Hook | When it runs |
|------|-------------|
| `beforeAll(fn)` | Once before all tests in the current suite |
| `afterAll(fn)` | Once after all tests in the current suite |
| `beforeEach(fn)` | Before each test in the current suite |
| `afterEach(fn)` | After each test in the current suite |

## Basic usage

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "unrift";

describe("database", () => {
  let db: Database;

  beforeAll(async () => {
    db = await Database.connect();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTransaction();
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("inserts a record", async () => {
    await db.insert({ name: "Alice" });
    const rows = await db.query("SELECT * FROM users");
    expect(rows).toHaveLength(1);
  });
});
```

## Inheritance

Hooks are inherited from parent suites. This is the execution order for nested suites:

```ts
describe("outer", () => {
  beforeEach(() => console.log("outer beforeEach"));
  afterEach(() => console.log("outer afterEach"));

  describe("inner", () => {
    beforeEach(() => console.log("inner beforeEach"));
    afterEach(() => console.log("inner afterEach"));

    it("runs hooks in order", () => {
      // Execution order:
      // 1. outer beforeEach
      // 2. inner beforeEach
      // 3. test
      // 4. inner afterEach
      // 5. outer afterEach
    });
  });
});
```

**Rule:** `beforeEach` runs outer-to-inner. `afterEach` runs inner-to-outer.

For `beforeAll`/`afterAll`, each suite's hooks run once for that suite's scope:

- `beforeAll` runs depth-first (parent before child)
- `afterAll` runs reverse depth-first (child before parent)

## Error handling

- If `beforeAll` fails, all tests in that suite are marked as skipped
- If `beforeEach` fails, the test is marked as failed
- `afterEach` always runs, even if the test or `beforeEach` failed
- `afterAll` always runs for suites that were entered (where `beforeAll` succeeded)
- Multiple hook errors are combined into a single error message

## Multiple hooks

You can register multiple hooks of the same type. They run in registration order:

```ts
beforeEach(() => console.log("first"));
beforeEach(() => console.log("second"));
// Output: "first", then "second"
```

## Async hooks

All hooks support async functions:

```ts
beforeAll(async () => {
  await seedDatabase();
});
```
