---
title: Async Testing
description: Test promises and async code with Unrift.
---

Unrift has built-in support for async test functions and promise-based assertions.

## Async tests

Test functions can be `async`. Unrift awaits them automatically:

```ts
import { describe, it, expect } from "unrift";

describe("API", () => {
  it("fetches data", async () => {
    const data = await fetchData();
    expect(data.status).toBe(200);
  });
});
```

## expect.resolves

Assert that a promise resolves to a specific value:

```ts
await expect(Promise.resolve(42)).resolves.toBe(42);
await expect(fetchUser("alice")).resolves.toEqual({ name: "Alice" });
```

If the promise rejects, the test fails with a descriptive error.

## expect.rejects

Assert that a promise rejects:

```ts
await expect(Promise.reject(new Error("fail"))).rejects.toThrow("fail");
await expect(failingOperation()).rejects.toThrow(/timeout/);
```

If the promise resolves, the test fails.

## Chaining with .not

Both `resolves` and `rejects` support `.not`:

```ts
await expect(Promise.resolve(42)).resolves.not.toBe(99);
```

## Timeouts

Async tests can be given a timeout via the config or CLI. If a test takes too long, it fails with a timeout error:

```ts
// unrift.config.ts
export default defineConfig({
  timeoutMs: 5000, // 5 seconds per test
});
```

Or per-run:

```bash
unrift --timeout 10000
```

## Hooks

Hooks can also be async:

```ts
let db: Database;

beforeAll(async () => {
  db = await Database.connect();
});

afterAll(async () => {
  await db.close();
});
```
