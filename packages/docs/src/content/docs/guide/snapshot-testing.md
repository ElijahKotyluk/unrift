---
title: Snapshot Testing
description: Compare values against stored snapshots with Unrift.
---

A snapshot test saves what a value looks like the first time it runs, then fails if it ever changes.

## toMatchSnapshot

```ts
import { describe, it, expect } from "unrift";

describe("user", () => {
  it("builds a profile", () => {
    expect(buildProfile("alice")).toMatchSnapshot();
  });
});
```

The first run writes the snapshot and passes. After that the value has to match what's stored, otherwise the test fails with a diff:

```
Snapshot `user builds a profile 1` doesn't match

- Received / + Snapshot

  {
-   "name": "Alicia",
+   "name": "Alice",
  }
```

If the change is expected, run with `-u` to update it:

```bash
unrift -u
```

You can pass a hint to make a snapshot easier to find in the file:

```ts
expect(admin).toMatchSnapshot("admin");
expect(guest).toMatchSnapshot("guest");
```

## Snapshot files

Snapshots live next to the test file in `__snapshots__/<file>.snap`, so `test/user.spec.ts` gets `test/__snapshots__/user.spec.ts.snap`. Commit them with your tests.

Each one is keyed by the describe blocks and test name joined with spaces, plus a counter for that test, same as Jest:

```js
// Unrift Snapshot v1

exports[`user builds a profile 1`] = `
{
  "name": "Alice",
  "roles": [
    "admin",
  ],
}
`;
```

Values are printed in Jest's format: sorted keys, trailing commas, `Map {`, `Set {`, `[Error: message]`, class names in front of instances. It's Unrift's own printer though, not `pretty-format`, so a snapshot file from Jest might need a `-u` run before it passes.

## Inline snapshots

`toMatchInlineSnapshot()` stores the snapshot in the test file instead, as the argument:

```ts
it("adds", () => {
  expect(add(1, 2)).toMatchInlineSnapshot();
});
```

After the first run the file reads:

```ts
it("adds", () => {
  expect(add(1, 2)).toMatchInlineSnapshot(`3`);
});
```

Multi-line values are indented to match the code. Mismatches, `-u` and CI work the same as `toMatchSnapshot`. Inline snapshots are never obsolete, deleting the call deletes the snapshot.

A few things it won't write:

- A call that runs more than once with different values, like in a loop.
- An argument that isn't a string or template literal, like a variable. Write a literal there or remove it.
- Under `.resolves` or `.rejects`. Comparing works, but to write one, await the value first and snapshot that.
- A test file you edited while the tests ran. The run says which file, run it again.

If a test is retried, only the last attempt's value is written.

## Obsolete snapshots

A stored snapshot that no test used is obsolete, like when you rename or delete a test. Obsolete snapshots fail the run until you remove them with `-u`.

Snapshots for tests that didn't run aren't obsolete. A skipped test, a test filtered out with `--grep` or `.only`, or a test that failed before reaching its snapshot keeps what it has. If a test file fails to import, its snapshot file isn't touched.

The counter is per test name though. If two tests have the same name and the first one is skipped, the second one reads `name 1`, which belongs to the skipped one. Give tests unique names.

In watch mode `-u` only applies to the first run, so a half-finished edit doesn't get saved as the new snapshot.

## On CI

When the `CI` environment variable is set, new snapshots aren't written and the test fails instead. That way a snapshot that was never committed doesn't quietly pass on CI. Run `unrift -u` locally and commit the file.

## Limitations

- `.not` isn't allowed with either matcher.
- Property matchers (`toMatchSnapshot({ id: expect.any(Number) })`) aren't supported yet.
- A snapshot file whose test file was deleted isn't reported, delete it yourself.
