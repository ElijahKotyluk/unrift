/**
 * Module mocking - main-thread registry and public API (Tier A).
 *
 * Tier A scope:
 *   - `mock.doMock(spec, factory)` registers a mock for an external module
 *     specifier (bare package name or `node:*` built-in).
 *   - Subsequent `await import(spec)` calls return the factory's result.
 *   - Static imports are NOT supported in Tier A; see the docs / ISSUES.md
 *     for the planned Tier B (hoisted `mock.module`) work.
 *
 * Architecture:
 *   - bin/unrift.mjs registers `module-loader.js` via `module.register()` and
 *     pipes a MessagePort into the loader thread.
 *   - The main-side port is stashed on `globalThis.__unriftLoaderPort` before
 *     the test runner starts.
 *   - `doMock()` invokes the factory once, caches the result on
 *     `globalThis.__unriftMocks`, and posts a `register` message with the
 *     spec + export-key list to the loader.
 *   - The loader (see module-loader.ts) drains pending messages on every
 *     resolve() and short-circuits matched specs to a synthetic module that
 *     reads back from `globalThis.__unriftMocks`.
 *
 * Future tiers will reuse the same registry shape and IPC protocol -
 * adding `register-hoisted` (Tier B) and `register-relative` (Tier C)
 * message types without breaking the existing surface.
 */

import { activeRestorers, spy } from "./spy";

// The mock registry and loader port below live on globalThis, which is
// process-global. This is correct under unrift's sequential single-process
// execution; parallel per-file execution (see ISSUES.md) would need the
// registry keyed/isolated per worker.

/**
 * Sentinel field name on globalThis. Loader-generated synthetic source
 * reads back through this same name, so it must stay stable.
 */
export const MOCKS_GLOBAL_KEY = "__unriftMocks";

/** Sentinel field name for the IPC port set by bin/unrift.mjs. */
export const LOADER_PORT_GLOBAL_KEY = "__unriftLoaderPort";

/** URL prefix the loader uses for mocked modules. Public so tests can assert. */
export const MOCK_URL_PREFIX = "unrift-mock:";

/**
 * Message contract between main thread and loader thread. Stable across
 * future tiers - new message types extend this union.
 *
 * `registrationId` is a monotonically increasing number embedded in the
 * synthetic mock URL. It defeats Node's URL-keyed module cache so that
 * re-mocking the same spec in a later test yields a fresh module (rather
 * than returning the previous test's cached mock).
 */
export type LoaderMessage =
  | {
      type: "register";
      spec: string;
      registrationId: number;
      exportKeys: readonly string[];
    }
  | { type: "unregister"; spec: string };

type ModuleFactory = () => Record<string, unknown>;

interface GlobalSlots {
  [MOCKS_GLOBAL_KEY]?: Map<string, Record<string, unknown>>;
  [LOADER_PORT_GLOBAL_KEY]?: {
    postMessage(msg: LoaderMessage): void;
  };
}

function globals(): GlobalSlots {
  return globalThis as unknown as GlobalSlots;
}

function ensureMocksMap(): Map<string, Record<string, unknown>> {
  const slots = globals();
  let map = slots[MOCKS_GLOBAL_KEY];
  if (!map) {
    map = new Map();
    slots[MOCKS_GLOBAL_KEY] = map;
  }
  return map;
}

function getLoaderPort():
  | { postMessage(msg: LoaderMessage): void }
  | undefined {
  return globals()[LOADER_PORT_GLOBAL_KEY];
}

/**
 * JS identifier check. ESM `export const <key>` requires a valid identifier;
 * keys that fail this check are skipped with a console.warn so the user
 * isn't surprised by a silently-missing export.
 */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function partitionExportKeys(
  spec: string,
  result: Record<string, unknown>,
): {
  validKeys: string[];
  skippedKeys: string[];
} {
  const validKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const key of Object.keys(result)) {
    if (key === "default" || IDENT_RE.test(key)) {
      validKeys.push(key);
    } else {
      skippedKeys.push(key);
    }
  }

  if (skippedKeys.length > 0) {
    console.warn(
      `[unrift] mock.doMock("${spec}"): factory returned ${skippedKeys.length} key(s) that are not valid ` +
        `JS identifiers and will not be exported: ${skippedKeys.join(", ")}`,
    );
  }

  return { validKeys, skippedKeys };
}

/**
 * Track every spec that's currently mocked so `unmock()` can find them
 * and `restoreAll()` can clean them all up at once.
 */
const mockedSpecs = new Set<string>();

/**
 * Monotonically increasing counter - every `doMock()` call gets a unique
 * ID embedded in its synthetic module URL, defeating Node's module cache
 * across re-registrations.
 */
let nextRegistrationId = 0;

/**
 * Restore hook registered with the spy/stub bulk-restore registry so
 * `mock.restoreAll()` cleans up module mocks too.
 */
const restoreAllMockedSpecs = (): void => {
  for (const spec of [...mockedSpecs]) {
    unmock(spec);
  }
  activeRestorers.delete(restoreAllMockedSpecs);
};

/**
 * Register a mock for `spec`. Subsequent `await import(spec)` calls will
 * resolve to the factory's return value instead of the real module.
 *
 * Tier A constraints (planned to be lifted in Tier B and beyond):
 *   - Only **dynamic** imports (`await import(spec)`) hit the mock; static
 *     `import { x } from "spec"` is hoisted by ESM above this call and
 *     will see the real module.
 *   - Only **external** specifiers work - bare package names (`"react"`)
 *     and Node built-ins (`"node:fs"`). Relative specs (`"./bar"`) are
 *     bundled inline by esbuild and can't be intercepted at runtime.
 *   - The factory is invoked **once** at registration time. Its return
 *     value is reused for every subsequent import.
 *
 * Throws if the Unrift CLI loader isn't attached (i.e., tests were run
 * with raw `node` instead of `unrift`).
 */
export function doMock(spec: string, factory: ModuleFactory): void {
  if (typeof spec !== "string" || spec.length === 0) {
    throw new TypeError("mock.doMock() requires a non-empty string specifier");
  }
  if (typeof factory !== "function") {
    throw new TypeError(
      "mock.doMock() requires a factory function returning an exports object",
    );
  }

  const port = getLoaderPort();
  if (!port) {
    throw new Error(
      "mock.doMock() requires the Unrift CLI loader to be installed. " +
        "Run tests via the `unrift` binary (or `node bin/unrift.mjs`), not raw `node`.",
    );
  }

  const result = factory();
  if (result === null || typeof result !== "object") {
    throw new TypeError(
      `mock.doMock("${spec}"): factory must return an object; got ${typeof result}`,
    );
  }

  const { validKeys } = partitionExportKeys(spec, result);

  ensureMocksMap().set(spec, result);
  mockedSpecs.add(spec);
  activeRestorers.add(restoreAllMockedSpecs);

  port.postMessage({
    type: "register",
    spec,
    registrationId: ++nextRegistrationId,
    exportKeys: validKeys,
  });
}

/**
 * Remove a previously registered mock. Subsequent `await import(spec)`
 * calls fall through to the real module.
 */
export function unmock(spec: string): void {
  const port = getLoaderPort();
  if (port) {
    port.postMessage({ type: "unregister", spec });
  }

  ensureMocksMap().delete(spec);
  mockedSpecs.delete(spec);
}

/** Returns the current set of mocked specs. Useful for tests / debugging. */
export function listMockedSpecs(): readonly string[] {
  return [...mockedSpecs];
}

/**
 * Convenience helper: imports the real module, builds a version with every
 * function export wrapped in a spy, registers it via `mock.doMock`, and
 * returns the mocked exports.
 *
 * Non-function exports are passed through unchanged. Tests can customize
 * individual spies with `.mockReturnValue`, `.mockImplementation`, etc.
 *
 * Subject to the same Tier A limits as `doMock` - only affects
 * `await import(spec)` after the call. Static imports of `spec` see the
 * real module.
 *
 * @example
 *   const fs = await mock.fromModule("node:fs");
 *   fs.readFileSync.mockReturnValue("fake content");
 *   // ... test code that does `await import("node:fs")` now gets the spies
 */
export async function fromModule<T extends Record<string, unknown>>(
  spec: string,
): Promise<T> {
  if (typeof spec !== "string" || spec.length === 0) {
    throw new TypeError(
      "mock.fromModule() requires a non-empty string specifier",
    );
  }

  const real = (await import(spec)) as Record<string, unknown>;
  const mocked: Record<string, unknown> = {};

  for (const key of Object.keys(real)) {
    const value = real[key];
    if (typeof value === "function") {
      // Auto-mock: create a spy with NO implementation, so unconfigured
      // exports record calls and return undefined rather than executing the
      // real function (which could fire real side effects). Tests opt in to
      // behavior per export via .mockReturnValue / .mockImplementation.
      mocked[key] = spy();
    } else {
      mocked[key] = value;
    }
  }

  doMock(spec, () => mocked);
  return mocked as T;
}
