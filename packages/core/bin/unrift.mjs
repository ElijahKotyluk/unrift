#!/usr/bin/env node
"use strict";

// Bootstrap the Unrift CLI.
//
// Before loading the test runner, register the Node module customization
// hook that powers `mock.doMock()` / `mock.unmock()` (Tier A module
// mocking - see packages/core/src/mock/module-loader.ts).
//
// The loader runs in a worker thread (Node 20.6+ / 18.19+ behavior) and
// receives a `MessagePort` over which the main thread posts
// register/unregister messages.

import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const loaderUrl = new URL(
  "file://" + resolvePath(__dirname, "../dist/esm/mock/module-loader.js"),
).href;

// `module.register()` was added in 18.19.0 / 20.6.0. Feature-detect so
// older Node versions still run unrift (just without module mocking).
if (typeof register === "function") {
  try {
    const { port1, port2 } = new MessageChannel();
    // Stash the main-side port on globalThis so `mock.doMock()` can
    // reach it without a circular import.
    globalThis.__unriftLoaderPort = port1;

    register(loaderUrl, import.meta.url, {
      data: { port: port2 },
      transferList: [port2],
    });
  } catch (err) {
    // Loader registration is best-effort - failing here shouldn't kill
    // the test run for users who don't use mock.doMock(). doMock()
    // itself throws a clear error if the port isn't available.
    if (process.env.UNRIFT_DEBUG === "1") {
      console.warn("[unrift] module loader registration failed:", err);
    }
  }
}

// Run the real CLI.
await import("../dist/esm/cli.js");
