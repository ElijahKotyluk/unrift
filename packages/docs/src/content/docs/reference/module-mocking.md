---
title: Module Mocking
description: Replace a module with a test double, static imports included.
---

## mock.module

`mock.module(spec, factory)` replaces a module for the whole test file. Every import of it gets the factory's exports, in the test file and in the files it imports.

```ts
import { it, expect, mock } from "unrift";
import { greet } from "../src/greet"; // imports ./user-service
import { getUser } from "../src/user-service";

mock.module("../src/user-service", () => ({
  getUser: mock.fn(() => ({ name: "mocked" })),
}));

it("greets the mocked user", () => {
  expect(greet(1)).toBe("hi mocked");
  expect(getUser).toHaveBeenCalledWith(1);
});
```

A call at the top of the file runs before the file's imports, like `jest.mock`. The real module doesn't load at all.

`spec` can be a relative path, a package (`axios`) or a built-in (`node:fs`). A path is resolved from the test file and matches every import that resolves to the same file. A package or built-in matches imports of that exact specifier.

### The real module

The factory gets `importActual`, which loads the real module. Make the factory async to use it:

```ts
mock.module("node:path", async (importActual) => {
  const real = await importActual<typeof import("node:path")>();

  return { ...real, basename: () => "mocked" };
});
```

An export the factory leaves out is `undefined`.

### Inside a test

A call inside a test or hook swaps the exports from then on. `mock.unmock(spec)` puts the real module back, await it since the real module may still have to load:

```ts
it("uses another user", async () => {
  mock.module("../src/user-service", () => ({
    getUser: () => ({ name: "other" }),
  }));
  expect(greet(1)).toBe("hi other");

  await mock.unmock("../src/user-service");
  expect(greet(1)).toBe("hi real");
});
```

Code that already ran with the old exports, like a value a module computed when it loaded, keeps what it got.

`mock.restoreAll()` doesn't undo `mock.module`, the module stays mocked.

### Limits

- The test file has to be TypeScript, and `spec` a string literal. Unrift finds the calls when it bundles the file.
- A factory at the top of the file runs before the file's other code. It can use Unrift's exports (`mock.fn()` and the rest), globals and `importActual`, not the file's own variables or imports.
- Only the test file's own calls count, not `mock.module` in a helper it imports.
- A `require()` of the mocked module gets the real one.
- To know what a CommonJS module exports, Unrift runs it once when it bundles the file. An ES module isn't run.
- A spy the factory makes is reset by `mock.resetAll()` and `mock.restoreAll()`, from any test file, since spies are shared across the run. Set its return value in the test or a `beforeEach`.

## mock.doMock

`mock.doMock(spec, factory)` mocks a package or built-in for later `await import(spec)` calls. It runs where you call it, so static imports aren't affected. Use `mock.module` for those.

```ts
mock.doMock("node:os", () => ({
  platform: () => "linux-mocked",
}));

const os = await import("node:os");
os.platform(); // "linux-mocked"
```

The factory runs once, each `doMock` of the same spec gives a fresh module. `mock.restoreAll()` removes `doMock` mocks, and `mock.listMockedSpecs()` lists them.

### mock.fromModule

`mock.fromModule(spec)` loads the real module, replaces every function export with a spy and mocks the module with the result. Other exports stay as they are.

```ts
const path = await mock.fromModule<typeof import("node:path")>("node:path");

path.join.mockReturnValue("/fake/joined/path");

const fresh = await import("node:path");
fresh.join("a", "b"); // "/fake/joined/path"
```

Like `doMock`, it only affects `await import(spec)` after the call.

## How it works

`mock.module`: when Unrift bundles a test file that calls it, an esbuild plugin

1. moves the top-level calls into a module imported before everything else in the file,
2. replaces each mocked module, wherever it's imported in the bundle, with a stand-in whose exports point at the factory's exports or the real module. Swapping the mock reassigns them, and the real module only loads when it isn't mocked.

`mock.doMock` goes through a Node module hook registered by the CLI. `await import(spec)` of a mocked spec gets a generated module that reads the factory's exports.
