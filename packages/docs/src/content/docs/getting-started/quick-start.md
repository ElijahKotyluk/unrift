---
title: Quick Start
description: Write and run your first test with Unrift.
---

## Create a test file

Create a file named `test/math.spec.ts`:

```ts
import { describe, it, expect } from "unrift";

describe("math", () => {
  it("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });

  it("compares objects deeply", () => {
    expect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] });
  });
});
```

## Run it

```bash
npx unrift
```

Unrift discovers `*.spec.ts` and `*.test.ts` files (and [other supported extensions](/guide/configuration/#test-file-discovery)) in the `test/` directory by default.

## Filter tests

Pass a regex pattern as the first argument to run a subset of files:

```bash
npx unrift math       # only files matching /math/
```

## Add a script

Add a test script to your `package.json`:

```json
{
  "scripts": {
    "test": "unrift"
  }
}
```

Then run with `npm test`, `pnpm test`, or `yarn test`.

## Next steps

- [Configure](/guide/configuration/) test directory, timeouts, and more
- [Explore all matchers](/reference/matchers/) available on `expect()`
- [Set up hooks](/reference/hooks/) for test setup and teardown
