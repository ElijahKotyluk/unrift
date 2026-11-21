/**
 * Module mocking.
 *
 * `mock.module(spec, factory)` replaces a module for a test file, static
 * imports too. The transform does most of the work, see
 * utils/moduleMockPlugin.ts. This file keeps its runtime side.
 *
 * `mock.doMock(spec, factory)` mocks a package or built-in for later
 * `await import(spec)` calls, through Node module hooks:
 *   - The CLI installs module-loader.ts with `module.registerHooks()`, see
 *     register-loader.ts.
 *   - `doMock()` runs the factory once, keeps the result on
 *     `globalThis.__unriftMocks` and the spec's export names in
 *     `registrations`.
 *   - The resolve hook points a registered spec at a generated module that
 *     reads back from `globalThis.__unriftMocks`.
 */

import { activeRestorers, spy } from "./spy";

// The registries below are per thread, a worker thread installs its own hooks
// and has its own mocks.

/**
 * Sentinel field name on globalThis. Loader-generated synthetic source
 * reads back through this same name, so it must stay stable.
 */
export const MOCKS_GLOBAL_KEY = "__unriftMocks";

/** URL prefix the loader uses for mocked modules. Public so tests can assert. */
export const MOCK_URL_PREFIX = "unrift-mock:";

/**
 * The specs the resolve hook mocks. `registrationId` goes in the generated
 * module's URL, so a later doMock of the same spec gets a new module instead
 * of Node's cached one.
 */
export const registrations = new Map<
  string,
  { registrationId: number; exportKeys: readonly string[] }
>();

let hooksInstalled = false;

/** Called by register-loader.ts once the hooks are in. */
export function setHooksInstalled(): void {
  hooksInstalled = true;
}

type ModuleFactory = () => Record<string, unknown>;

interface GlobalSlots {
  [MOCKS_GLOBAL_KEY]?: Map<string, Record<string, unknown>>;
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
    unmockExternal(spec);
  }
  activeRestorers.delete(restoreAllMockedSpecs);
};

/**
 * Register a mock for `spec`. Subsequent `await import(spec)` calls will
 * resolve to the factory's return value instead of the real module.
 *
 * Limits, `mock.module` has none of them:
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

  if (!hooksInstalled) {
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

  registrations.set(spec, {
    registrationId: ++nextRegistrationId,
    exportKeys: validKeys,
  });
}

/**
 * Remove a previously registered mock. Imports of `spec` get the real module
 * again. For a `mock.module` mock the real module may still have to load,
 * await the result before using it.
 */
export function unmock(spec: string): Promise<void> {
  const entry = moduleMocks().get(spec);

  if (!entry) {
    unmockExternal(spec);

    return Promise.resolve();
  }

  entry.mocked = false;
  entry.exports = undefined;

  const bind = entry.bind;

  if (!bind) return Promise.resolve();

  return entry.loadReal().then((real) => {
    // Mocked again while the real module loaded
    if (!entry.mocked) bind(real);
  });
}

function unmockExternal(spec: string): void {
  registrations.delete(spec);
  ensureMocksMap().delete(spec);
  mockedSpecs.delete(spec);
}

/** Global holding `mock.module` mocks, read by the generated modules. */
export const MODULE_MOCKS_GLOBAL_KEY = "__unriftModuleMocks";

/**
 * One mocked module in one test file. The transform creates it before the
 * file's imports run (see moduleMockPlugin.ts) and the module standing in
 * for the real one sets `bind`, which points its exports at `exports` or at
 * the real module.
 */
export type ModuleMockEntry = {
  spec: string;
  loadReal: () => Promise<Record<string, unknown>>;
  mocked: boolean;
  exports?: Record<string, unknown>;
  bind?: (exports: Record<string, unknown>) => void;
};

function moduleMocks(): Map<string, ModuleMockEntry> {
  const slots = globalThis as unknown as Record<string, unknown>;

  return ((slots[MODULE_MOCKS_GLOBAL_KEY] as
    | Map<string, ModuleMockEntry>
    | undefined) ??= new Map()) as Map<string, ModuleMockEntry>;
}

export type ModuleFactoryWithActual = (
  importActual: <T = Record<string, unknown>>() => Promise<T>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Replace a module for the test file: every import of `spec`, in the test
 * file and in the files it imports, gets the factory's exports.
 *
 * A call at the top of the file runs before the file's imports. Unrift
 * finds the calls when it bundles the file, so `spec` has to be a string
 * literal in a TypeScript test file. A call inside a test or hook swaps
 * the exports from then on.
 *
 * The factory gets `importActual`, which loads the real module. An async
 * factory makes the call return a promise.
 */
export function mockModule(
  spec: string,
  factory: ModuleFactoryWithActual,
): void | Promise<void> {
  if (typeof factory !== "function") {
    throw new TypeError(
      "mock.module() requires a factory function returning an exports object",
    );
  }

  const entry = moduleMocks().get(spec);

  if (!entry) {
    throw new Error(
      `mock.module("${spec}"): Unrift didn't find this call when it bundled the test file. ` +
        "Call it in a TypeScript test file, with the specifier as a string literal.",
    );
  }

  const apply = (exports: unknown) => {
    if (exports === null || typeof exports !== "object") {
      throw new TypeError(
        `mock.module("${entry.spec}"): factory must return an object; got ${exports === null ? "null" : typeof exports}`,
      );
    }

    entry.mocked = true;
    entry.exports = exports as Record<string, unknown>;
    entry.bind?.(entry.exports);
  };

  const explain = (err: unknown): never => {
    if (err instanceof ReferenceError) {
      err.message =
        `mock.module("${entry.spec}"): ${err.message}. A call at the top of the file runs before ` +
        "the file's imports and code, its factory can only use Unrift's exports, globals and importActual.";
    }

    throw err;
  };

  const importActual = <T>() => entry.loadReal() as Promise<T>;

  let result: ReturnType<ModuleFactoryWithActual>;

  try {
    result = factory(importActual);
  } catch (err) {
    return explain(err);
  }

  if (result && typeof (result as Promise<unknown>).then === "function") {
    return (result as Promise<Record<string, unknown>>).then(apply, explain);
  }

  apply(result);
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
 * Subject to the same limits as `doMock` - only affects
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
