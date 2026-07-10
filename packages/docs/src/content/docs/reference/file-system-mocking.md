---
title: File System Mocking
description: Replace node:fs with an in-memory volume via mock.fs.
---

`mock.fs()` patches `node:fs` and `node:fs/promises` with an in-memory file system, so tests can write, read, list, and delete files without touching disk. The fake is backed by [`memfs`](https://github.com/streamich/memfs) internally - that's an implementation detail behind a clean interface, and is intended to be swappable later.

```ts
import { mock, afterEach } from "unrift";

afterEach(() => mock.restoreAll());

it("reads config from disk", async () => {
  mock.fs({
    "/etc/app/config.json": '{"feature": "on"}',
  });

  const fs = await import("node:fs");
  const config = JSON.parse(fs.readFileSync("/etc/app/config.json", "utf8"));
  expect(config.feature).toBe("on");
});
```

`mock.fs()` is layered on the [Tier A module-mocking](./module-mocking) machinery, which means it inherits Tier A's limits - see [Supported and not-yet-supported](#supported-and-not-yet-supported) below.

## The handle

`mock.fs()` returns a control handle for inspecting and manipulating the in-memory volume directly, without going through `await import("node:fs")`.

```ts
const fs = mock.fs({ "/x": "initial" });

fs.read("/x");                         // → "initial"
fs.write("/path/to/new.txt", "hi");    // parent dirs auto-created
fs.exists("/path/to/new.txt");         // → true
fs.list("/path/to");                   // → ["new.txt"]
fs.delete("/path/to/new.txt");         // → true
fs.toJSON();                           // → { "/x": "initial" }
fs.fromJSON({ "/y": "replaced" });     // wipe + reseed
fs.restore();                          // unpatch (idempotent)
```

| Method | Purpose |
| --- | --- |
| `read(path)` | Returns the file's contents, or `null` if missing |
| `write(path, content)` | Writes a file, auto-creating parent directories |
| `exists(path)` | Returns `true` if the path is in the volume |
| `delete(path)` | Removes a file; returns `true` if something was deleted |
| `list(dir)` | Lists entries in a directory; returns `[]` if missing |
| `toJSON()` | Dumps the current state as a path-to-content map |
| `fromJSON(state)` | Wipes the volume and reseeds from the given map |
| `restore()` | Tears down the module-mocking registration |

The handle's helpers are deliberately small and storage-agnostic - they don't depend on memfs's exact API, so the backend can be swapped without breaking your tests.

## Initial state

The optional argument to `mock.fs()` is a path-to-content map:

```ts
mock.fs({
  "/etc/app/config.json": '{"key":"value"}',
  "/data/users.csv": "id,name\n1,alice",
  "/tmp/empty-dir": null,
});
```

`null` represents an empty directory. Strings are file contents. Parent directories are inferred from the path structure.

## Patching node:fs

Once `mock.fs()` is called, `await import("node:fs")` returns a fully-featured `fs` object backed by the volume:

```ts
mock.fs({ "/etc/hostname": "test-host\n" });

const fs = await import("node:fs");
fs.readFileSync("/etc/hostname", "utf8");  // → "test-host\n"
fs.writeFileSync("/new/file.txt", "hi");   // updates the volume
fs.existsSync("/etc/hostname");            // → true
```

The promises API works the same way:

```ts
const fsp = await import("node:fs/promises");
await fsp.writeFile("/x", "hello");
const content = await fsp.readFile("/x", "utf8"); // → "hello"
```

## Replacing the volume

Calling `mock.fs()` again while a fake is installed replaces the previous volume with a fresh one. The previous handle still references its old (now-orphaned) volume - useful for tests that snapshot intermediate state.

```ts
const first = mock.fs({ "/a": "1" });
const second = mock.fs({ "/b": "2" });

second.exists("/a");  // → false (fresh volume)
second.exists("/b");  // → true
first.exists("/a");   // → true (handle still points at the old volume)

first.restore();      // → no-op: `first` no longer owns the interception,
                      //   so this can't tear down `second`'s volume
```

Calling `restore()` on a superseded handle is a safe no-op - only the handle that currently owns the interception can tear it down. This means you can keep an old handle around for snapshotting without risking that a later `restore()` rips out the active volume.

## Lifecycle

| Call | Effect |
| --- | --- |
| `handle.restore()` | Tears down `node:fs` / `node:fs/promises` registrations **for this handle**. No-op if a later `mock.fs()` superseded it. The backend volume stays alive so `handle.toJSON()` still works for post-mortem inspection. |
| `mock.restoreAll()` | Unpatches everything (fs included) as part of bulk cleanup. |

Idiomatic cleanup pattern:

```ts
import { afterEach, mock } from "unrift";

afterEach(() => {
  mock.restoreAll();
});
```

## Supported and not-yet-supported

`mock.fs()` is built on the [Tier A module-mocking](./module-mocking) implementation, so it inherits the same import-shape limits.

### Supported

- `await import("node:fs")` returns the fake
- `await import("node:fs/promises")` returns the fake
- Reading, writing, listing, stat-ing, existence checks
- The whole memfs surface - streams, file descriptors, `cpSync`, `mkdtempSync`, etc.

### Not yet supported

| Limit | Workaround today | Lifted by |
| --- | --- | --- |
| **Static** imports of `node:fs` (`import { readFileSync } from "node:fs"`) see the real fs. ESM hoists static imports above your test body, so `mock.fs()` runs too late. | Use `await import("node:fs")` for the call sites you want to mock. Other static imports in the same file are unaffected. | Tier B module mocking |
| Code under test compiled by a bundler that **inlines** `node:fs` access | Refactor the code to import `node:fs` at runtime, or skip mocking and use real temp dirs. | n/a (bundler concern, not unrift's) |
| Reading from / writing to the **real** filesystem alongside the fake | After `mock.fs()`, `node:fs` IS the fake - temporarily call `mock.restoreAll()` if you need real-fs access mid-test. | n/a (intentional) |

## Backend implementation notes

The current backend is `memfs`. It's wrapped behind an internal `FakeFsBackend` interface so the dependency can be swapped without breaking user code. If you're depending on memfs-specific behavior (e.g. internal `Volume` mutation), prefer the `FakeFsHandle` methods documented above - those are guaranteed stable across backend changes.

A hand-rolled replacement is planned eventually. The contract on the public side won't change.

## When to use which

- **`mock.fs()`** - code under test reads/writes via `await import("node:fs")` or `node:fs/promises`, and you want a clean, isolated, mutable filesystem per test.
- **Real `node:fs` with `mkdtempSync`** - code under test uses static imports of `node:fs`, AND/OR depends on filesystem semantics that memfs doesn't perfectly emulate (e.g., specific `inode` numbers, `chmod` bits propagating through directories, real symlinks).
- **Pass an `fs`-shaped object as a constructor argument** - code under test already takes its fs dependency via DI. In this case `mock.fs()` is still useful: pass `mock.fs().toJSON` or wire up the handle's helpers.
