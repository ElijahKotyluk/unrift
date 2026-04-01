---
title: Custom Matchers
description: Extend Unrift with your own matchers.
---

Unrift supports custom matchers through the `expect.extend()` API. This lets you add domain-specific assertions to your test suite.

## Creating a matcher

```ts
import { expect } from "unrift";

expect.extend({
  toBePositive(received: unknown) {
    const pass = typeof received === "number" && received > 0;

    if (this.isNot ? pass : !pass) {
      throw new Error(this.diff(received, "a positive number"));
    }
  },
});

// Now you can use it
expect(5).toBePositive();
expect(-1).not.toBePositive();
```

## The matcher function

Each matcher is a function that receives the value passed to `expect()` as its first argument, followed by any arguments passed to the matcher call.

```ts
expect.extend({
  toBeWithinRange(received: unknown, floor: number, ceiling: number) {
    const num = received as number;
    const pass = num >= floor && num <= ceiling;

    if (this.isNot ? pass : !pass) {
      throw new Error(this.diff(received, `between ${floor} and ${ceiling}`));
    }
  },
});

expect(5).toBeWithinRange(1, 10);
```

## MatcherContext

Inside a matcher function, `this` is a `MatcherContext` with:

| Property | Type | Description |
|----------|------|-------------|
| `isNot` | `boolean` | `true` when called via `.not` |
| `diff(received, expected)` | `(a, b) => string` | Formats a diff message for the error |

The `isNot` flag is critical — your matcher must handle both the normal and negated case:

```ts
if (this.isNot ? pass : !pass) {
  throw new Error(this.diff(received, expected));
}
```

This pattern means:
- **Normal** (`expect(x).toFoo()`): throw if `!pass`
- **Negated** (`expect(x).not.toFoo()`): throw if `pass`

## Matcher packages

You can ship matchers as a separate npm package. The package should call `expect.extend()` when imported:

```ts
// my-matchers/index.ts
import { expect } from "unrift";

expect.extend({
  toBeEven(received: unknown) { /* ... */ },
  toBeOdd(received: unknown) { /* ... */ },
});
```

Then register it in your config:

```ts
// unrift.config.ts
import { defineConfig } from "unrift";

export default defineConfig({
  matchers: ["my-matchers"],
});
```

## Inspecting registered matchers

`expect.matchers` is a read-only property that returns all currently registered matchers:

```ts
import { expect } from "unrift";

console.log(Object.keys(expect.matchers));
// ["toBe", "toEqual", "toThrow", ...]
```

## extendMatchers

Unrift also exports `extendMatchers` as a standalone function. It behaves identically to `expect.extend()` but can be imported directly:

```ts
import { extendMatchers } from "unrift";

extendMatchers({
  toBePositive(received: unknown) { /* ... */ },
});
```

In most cases, prefer `expect.extend()` for clarity.

## TypeScript support

To get type checking for custom matchers, use declaration merging:

```ts
import { expect, type Matchers } from "unrift";

declare module "unrift" {
  interface Matchers<T> {
    toBePositive(): void;
    toBeWithinRange(floor: number, ceiling: number): void;
  }
}

expect.extend({
  toBePositive(received: unknown) { /* ... */ },
  toBeWithinRange(received: unknown, floor: number, ceiling: number) { /* ... */ },
});
```
