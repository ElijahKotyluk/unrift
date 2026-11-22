/**
 * Entry point of a worker thread, see workers.ts. Runs the files the main
 * thread sends, one at a time, then finishes the run when told to.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { parentPort, workerData } from "node:worker_threads";

import { registerModuleLoader } from "./mock/register-loader";
import { startRun, type EngineOptions } from "./run";
import { bundledFiles } from "./utils/transform";
import { copyFileRun, type FromWorker, type ToWorker } from "./workers";

// Before any test can fake it
const microtask = globalThis.queueMicrotask;
const immediate = globalThis.setImmediate;

// Hooks added in the main thread don't reach this one
registerModuleLoader();

const port = parentPort!;
const post = (message: FromWorker) => port.postMessage(message);

const { options, bailed } = workerData as {
  options: EngineOptions;
  bailed: Int32Array;
};

// Shared by all workers, a bail in any of them stops the rest
const state = {
  get bailed() {
    return Atomics.load(bailed, 0) === 1;
  },
  set bailed(value: boolean) {
    Atomics.store(bailed, 0, value ? 1 : 0);
  },
};

const run = await startRun(options, state);

// What a file writes goes to the main thread as it's written, which prints
// it in file order. Sent right away, it isn't lost if the test exits the
// worker. A write from a timer a file left belongs to that file, even once
// the worker runs another: its async context says which. A write with none
// goes to the file that ran last. Writes before the first file go out as
// they happen.
const file = new AsyncLocalStorage<number>();
let current: number | null = null;

for (const stream of ["stdout", "stderr"] as const) {
  const target = process[stream];
  const write = target.write.bind(target) as (...args: unknown[]) => boolean;

  target.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const index = file.getStore() ?? current;

    if (index === null) return write(chunk, ...rest);

    const encoding = typeof rest[0] === "string" ? rest[0] : "utf8";

    // Bytes, a character split across two writes decodes in the main thread
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk, encoding as BufferEncoding)
        : Buffer.from(chunk);

    post({ type: "output", index, stream, bytes });

    // The callback, if any, comes last
    const done = rest.find((arg) => typeof arg === "function");

    if (done) microtask(done as () => void);

    return true;
  }) as typeof target.write;
}

// One file at a time, in the order they came
let queue = Promise.resolve();

port.on("message", (message: ToWorker) => {
  queue = queue.then(async () => {
    if (message.type === "file") {
      current = message.index;
      post({ type: "started", index: message.index });

      const result = await file.run(message.index, () =>
        run.runFile(message.file),
      );
      // Its snapshots go with it, a crash later can't lose them
      const part = run.take();

      // Until the next file starts, output with no file of its own goes to this one
      post({
        type: "file",
        index: message.index,
        run: copyFileRun(result),
        part,
      });
    } else {
      const end = await run.finish();

      // An error thrown right after, like from a setImmediate the afterAll
      // left, stops the worker before it ends: it's still part of the run
      await new Promise((resolve) => immediate(resolve));

      post({
        type: "end",
        end: { ...end, root: copyFileRun(end.root) },
        bundled: bundledFiles(),
      });
    }
  });
});

post({ type: "ready" });
