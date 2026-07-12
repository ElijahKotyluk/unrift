---
title: Matchers
description: Complete reference for all built-in matchers.
---

All matchers are available on the object returned by `expect(value)`. Every matcher supports `.not` for negation.

## Equality

### `toBe(expected)`

Strict equality using `Object.is`. Use for primitives and reference checks.

```ts
expect(1 + 1).toBe(2);
expect("hello").toBe("hello");
expect(NaN).toBe(NaN);           // passes (Object.is semantics)

const obj = { a: 1 };
expect(obj).toBe(obj);            // same reference
expect({ a: 1 }).not.toBe({ a: 1 }); // different references
```

### `toEqual(expected)`

Deep structural equality. Prototype-insensitive - compares by shape, not by constructor.

```ts
expect({ a: 1 }).toEqual({ a: 1 });
expect([1, 2, 3]).toEqual([1, 2, 3]);

// Prototype doesn't matter
class Foo { x = 1; }
expect(new Foo()).toEqual({ x: 1 }); // passes
```

Sparse array holes are treated as `undefined`. Missing keys with value `undefined` are equal to absent keys.

### `toStrictEqual(expected)`

Deep structural equality with prototype checking. Both sides must have the same prototype chain.

```ts
expect({ a: 1 }).toStrictEqual({ a: 1 });

class Foo { x = 1; }
expect(new Foo()).not.toStrictEqual({ x: 1 }); // different prototypes
```

## Truthiness

### `toBeDefined()`

Passes when the value is not `undefined`.

```ts
expect(0).toBeDefined();
expect("").toBeDefined();
expect(null).toBeDefined();
expect(undefined).not.toBeDefined();
```

### `toBeUndefined()`

Passes when the value is `undefined`.

```ts
expect(undefined).toBeUndefined();
expect(null).not.toBeUndefined();
```

### `toBeTruthy()`

Passes when the value is truthy (i.e., `Boolean(value)` is `true`).

```ts
expect(1).toBeTruthy();
expect("hello").toBeTruthy();
expect(0).not.toBeTruthy();
```

### `toBeFalsy()`

Passes when the value is falsy.

```ts
expect(0).toBeFalsy();
expect("").toBeFalsy();
expect(null).toBeFalsy();
expect(1).not.toBeFalsy();
```

### `toBeNull()`

Passes when the value is `null`.

```ts
expect(null).toBeNull();
expect(undefined).not.toBeNull();
```

## Numbers

### `toBeGreaterThan(expected)`

Passes when the received number is greater than `expected`.

```ts
expect(10).toBeGreaterThan(5);
expect(5).not.toBeGreaterThan(10);
```

### `toBeLessThan(expected)`

Passes when the received number is less than `expected`.

```ts
expect(5).toBeLessThan(10);
expect(10).not.toBeLessThan(5);
```

### `toBeGreaterThanOrEqual(expected)`

Passes when the received number is greater than or equal to `expected`.

```ts
expect(10).toBeGreaterThanOrEqual(10);
expect(11).toBeGreaterThanOrEqual(10);
expect(9).not.toBeGreaterThanOrEqual(10);
```

### `toBeLessThanOrEqual(expected)`

Passes when the received number is less than or equal to `expected`.

```ts
expect(10).toBeLessThanOrEqual(10);
expect(9).toBeLessThanOrEqual(10);
expect(11).not.toBeLessThanOrEqual(10);
```

### `toBeNaN()`

Passes when the value is `NaN`.

```ts
expect(NaN).toBeNaN();
expect(0 / 0).toBeNaN();
expect(1).not.toBeNaN();
```

### `toBeFinite()`

Passes when the value is a finite number (not `NaN`, `Infinity`, or `-Infinity`).

```ts
expect(42).toBeFinite();
expect(Infinity).not.toBeFinite();
expect(NaN).not.toBeFinite();
```

## Strings

### `toMatch(expected)`

Passes when the string contains the substring or matches the regex.

```ts
expect("hello world").toMatch("world");
expect("hello world").toMatch(/^hello/);
expect("hello").not.toMatch("xyz");
```

## Collections

### `toContain(expected)`

For arrays, checks if the item is in the array (using `Array.includes`). For strings, checks for a substring.

```ts
expect([1, 2, 3]).toContain(2);
expect("hello").toContain("ell");
expect([1, 2]).not.toContain(5);
```

### `toHaveLength(expected)`

Checks the `.length` property of arrays, strings, or any object with a `length`.

```ts
expect([1, 2, 3]).toHaveLength(3);
expect("hello").toHaveLength(5);
expect([]).toHaveLength(0);
```

## Objects

### `toMatchObject(expected)`

Checks that the received object contains all properties in `expected`. The received object may have additional properties - this is a partial match.

```ts
expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });          // passes
expect({ a: 1 }).not.toMatchObject({ a: 1, b: 2 });      // passes (missing b)

// Nested partial matching
expect({ user: { name: "Alice", age: 30 } }).toMatchObject({ user: { name: "Alice" } });
```

### `toHaveProperty(path, value?)`

Checks that the received object has the specified property. Optionally asserts the property's value.

`path` can be a dot-notation string (`"a.b.c"`) or an array of keys (`["a", "b", "c"]`).

```ts
const obj = { user: { name: "Alice", roles: ["admin"] } };

expect(obj).toHaveProperty("user");
expect(obj).toHaveProperty("user.name");
expect(obj).toHaveProperty("user.name", "Alice");
expect(obj).toHaveProperty(["user", "name"], "Alice");
expect(obj).not.toHaveProperty("user.email");
```

## Types

### `toBeInstanceOf(expected)`

Checks that the value is an instance of the given constructor.

```ts
expect(new Date()).toBeInstanceOf(Date);
expect(new Error("x")).toBeInstanceOf(Error);
expect({}).not.toBeInstanceOf(Array);
```

## Exceptions

### `toThrow(expected?)`

Checks that a function throws when called. Optionally match the error:

```ts
// Any throw
expect(() => { throw new Error("boom"); }).toThrow();

// Match by message substring
expect(() => { throw new Error("boom"); }).toThrow("boom");

// Match by regex
expect(() => { throw new Error("boom"); }).toThrow(/bo+m/);

// Match by error class
expect(() => { throw new TypeError("bad"); }).toThrow(TypeError);

// Match by object shape
expect(() => { throw new Error("fail"); }).toThrow({ message: "fail" });
```

:::caution
`toThrow` only works with synchronous functions. If you pass an async function, Unrift will throw an error prompting you to use `expect(fn).rejects.toThrow()` instead.
:::

## Negation

All matchers support `.not`:

```ts
expect(1).not.toBe(2);
expect([]).not.toContain(5);
expect(() => {}).not.toThrow();
```

## Async matchers

See [Async Testing](/guide/async-testing/) for `expect.resolves` and `expect.rejects`.
