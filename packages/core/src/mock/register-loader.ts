/**
 * Installs the module hooks behind `mock.doMock`, `mock.fromModule` and
 * `mock.fs`. The CLI calls it before any test file is imported.
 *
 * `module.registerHooks()` runs the hooks in this thread. Call it again in
 * each worker thread, hooks don't carry over.
 */

import { registerHooks } from "node:module";

import { load, resolve } from "./module-loader.js";
import { setHooksInstalled } from "./module.js";

let done = false;

export function registerModuleLoader(): void {
  if (done) return;
  done = true;

  try {
    registerHooks({ resolve, load });
    setHooksInstalled();
  } catch (err) {
    // Runs that don't mock modules still work, doMock says it needs the hooks
    if (process.env.UNRIFT_DEBUG === "1") {
      console.warn("[unrift] module hook registration failed:", err);
    }
  }
}
