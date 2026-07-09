/**
 * Registers the Node module-customization hook that powers module mocking
 * (mock.doMock / mock.fs / mock.fromModule).
 *
 * This is called once, early in the CLI startup (see cli.ts) - before any
 * test file is dynamically imported. Because it lives in @unrift/core next to
 * the loader, both the `@unrift/core` bin and the `unrift` wrapper bin get it
 * "for free" by going through the shared CLI; neither bin needs its own
 * bootstrap logic.
 *
 * The loader runs in a worker thread and receives a MessagePort over which
 * the main thread posts register/unregister messages. The main-side port is
 * stashed on globalThis so mock.doMock() can reach it without a circular
 * import back into the CLI.
 */

import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";

import { LOADER_PORT_GLOBAL_KEY } from "./module";

let done = false;

export function registerModuleLoader(): void {
  if (done) return;
  done = true;

  // `module.register()` was added in 18.19.0 / 20.6.0. On older Node, module
  // mocking simply isn't available - doMock() throws a clear error if used.
  if (typeof register !== "function") return;

  try {
    const { port1, port2 } = new MessageChannel();
    (globalThis as Record<string, unknown>)[LOADER_PORT_GLOBAL_KEY] = port1;

    // Resolve the loader relative to this module - it's a sibling file, so no
    // package export or cross-package specifier is involved.
    register("./module-loader.js", import.meta.url, {
      data: { port: port2 },
      transferList: [port2],
    });
  } catch (err) {
    // Best-effort: a failure here must not crash test runs that don't use
    // module mocking.
    if (process.env.UNRIFT_DEBUG === "1") {
      console.warn("[unrift] module loader registration failed:", err);
    }
  }
}
