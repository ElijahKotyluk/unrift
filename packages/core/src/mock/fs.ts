/**
 * File system mocking - `mock.fs()`.
 *
 * Backed by `memfs` today (private implementation detail behind the
 * `FakeFsBackend` interface). The plan is to swap memfs for a hand-rolled
 * package later; consumers of this module should only depend on the public
 * `FakeFsHandle` surface, not on memfs types directly.
 *
 * Interception is layered on Tier A module mocking - `mock.doMock` is
 * called for `node:fs` and `node:fs/promises`, so the fake takes effect
 * when test code does `await import("node:fs")` or `await import("node:fs/promises")`.
 * Static `import { readFileSync } from "node:fs"` is NOT intercepted in
 * Tier A (planned for Tier B). See the docs page for the explicit limit
 * list and workarounds.
 */

import { Volume, createFsFromVolume } from "memfs";

import { doMock, unmock } from "./module";
import { activeRestorers } from "./spy";

/**
 * `Volume.fromJSON()` accepts a path-to-content map. `null` represents an
 * empty directory; strings are file contents.
 */
export type FakeFsState = Record<string, string | null>;

/**
 * Internal abstraction - anything that satisfies this can back `mock.fs`.
 * Hides memfs entirely so future implementations can drop in without
 * touching the public API.
 */
interface FakeFsBackend {
  /** node:fs-compatible exports object passed to mock.doMock. */
  fsExports: Record<string, unknown>;
  /** node:fs/promises-compatible exports object. */
  fsPromisesExports: Record<string, unknown>;
  /** Serialize current state to a JSON-safe path-to-content map. */
  toJSON(): FakeFsState;
  /** Reset state to the given JSON map. */
  fromJSON(state: FakeFsState): void;
  /** Direct read helper used by FakeFsHandle.read(). */
  readFile(path: string): string | null;
  /** Direct write helper used by FakeFsHandle.write(). */
  writeFile(path: string, content: string): void;
  /** Direct exists helper used by FakeFsHandle.exists(). */
  exists(path: string): boolean;
  /** Direct delete helper used by FakeFsHandle.delete(). */
  remove(path: string): boolean;
  /** Direct directory listing helper. */
  list(dir: string): string[];
}

/**
 * The current implementation factory. Swap this single line when replacing
 * memfs with a hand-rolled backend - no other code changes needed.
 */
function createBackend(initial?: FakeFsState): FakeFsBackend {
  const vol = Volume.fromJSON(initial ?? {});
  const fsExports = createFsFromVolume(vol) as unknown as Record<
    string,
    unknown
  >;
  // memfs's createFsFromVolume returns the fs surface; .promises is on it.
  const fsPromisesExports = (fsExports as { promises: Record<string, unknown> })
    .promises;

  return {
    fsExports,
    fsPromisesExports,
    toJSON: () => vol.toJSON() as FakeFsState,
    fromJSON: (state) => {
      vol.reset();
      vol.fromJSON(state);
    },
    readFile: (path) => {
      try {
        return vol.readFileSync(path, "utf8") as string;
      } catch {
        return null;
      }
    },
    writeFile: (path, content) => {
      // memfs throws if the parent directory doesn't exist; create it for
      // ergonomic test code.
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash > 0) {
        vol.mkdirSync(path.slice(0, lastSlash), { recursive: true });
      }
      vol.writeFileSync(path, content);
    },
    exists: (path) => vol.existsSync(path),
    remove: (path) => {
      try {
        vol.unlinkSync(path);
        return true;
      } catch {
        return false;
      }
    },
    list: (dir) => {
      try {
        return vol.readdirSync(dir) as string[];
      } catch {
        return [];
      }
    },
  };
}

/** Public handle returned by `mock.fs()`. */
export interface FakeFsHandle {
  /** Dump the current state as a path-to-content map. */
  toJSON(): FakeFsState;
  /** Replace the current state with the given map. */
  fromJSON(state: FakeFsState): void;
  /** Read a file's contents, or null if it doesn't exist. */
  read(path: string): string | null;
  /** Write a file, creating parent directories as needed. */
  write(path: string, content: string): void;
  /** Check whether a path exists in the fake fs. */
  exists(path: string): boolean;
  /** Delete a file. Returns true if something was removed. */
  delete(path: string): boolean;
  /** List entries in a directory. Returns an empty array if missing. */
  list(dir: string): string[];
  /**
   * Unpatch node:fs and node:fs/promises for this handle's interception.
   * Idempotent, and a no-op if a later mock.fs() call has already superseded
   * this handle - so holding an old handle for snapshotting can't tear down
   * the current volume's interception.
   */
  restore(): void;
}

let activeBackend: FakeFsBackend | undefined;
let activeHandle: FakeFsHandle | undefined;

const restoreFakeFs = (): void => {
  if (!activeBackend) return;
  unmock("node:fs");
  unmock("node:fs/promises");
  activeBackend = undefined;
  activeHandle = undefined;
  activeRestorers.delete(restoreFakeFs);
};

/**
 * Install an in-memory file system as `node:fs` and `node:fs/promises`
 * for the duration of the test. Subsequent `await import("node:fs")`
 * calls return the fake.
 *
 * Calling `mock.fs()` while a fake is already installed swaps in a fresh
 * volume - the previous handle's references stop receiving updates.
 */
export function fs(initial?: FakeFsState): FakeFsHandle {
  // Tear down any existing fake before installing the new one so the
  // module-mocking registrations don't stack.
  if (activeBackend) {
    unmock("node:fs");
    unmock("node:fs/promises");
  }

  const backend = createBackend(initial);
  activeBackend = backend;

  doMock("node:fs", () => backend.fsExports);
  doMock("node:fs/promises", () => backend.fsPromisesExports);
  activeRestorers.add(restoreFakeFs);

  const handle: FakeFsHandle = {
    toJSON: () => backend.toJSON(),
    fromJSON: (state) => backend.fromJSON(state),
    read: (path) => backend.readFile(path),
    write: (path, content) => backend.writeFile(path, content),
    exists: (path) => backend.exists(path),
    delete: (path) => backend.remove(path),
    list: (dir) => backend.list(dir),
    // Only tear down the interception if THIS handle still owns it. A later
    // mock.fs() call orphans this handle - its volume lives on for snapshot
    // inspection, but restoring it must not rip out the newer volume's
    // interception. On an orphaned handle this is a no-op (also makes restore
    // idempotent: a second call finds activeBackend already cleared).
    restore: () => {
      if (activeBackend === backend) restoreFakeFs();
    },
  };

  activeHandle = handle;
  return handle;
}

/** Returns the current handle if `mock.fs()` is installed, otherwise undefined. */
export function getActiveFsHandle(): FakeFsHandle | undefined {
  return activeHandle;
}
