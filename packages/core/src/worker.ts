/**
 * Entry point of a worker thread, see workers.ts. Runs the files the main
 * thread sends, one at a time, then finishes the run when told to.
 */

import { parentPort, workerData } from "node:worker_threads";

import { registerModuleLoader } from "./mock/register-loader";
import { startRun, type EngineOptions } from "./run";
import { bundledFiles } from "./utils/transform";
import {
  copyFileRun,
  type FromWorker,
  type Output,
  type ToWorker,
} from "./workers";

// Hooks added in the main thread don't reach this one
registerModuleLoader();

const port = parentPort!;
const post = (message: FromWorker) => port.postMessage(message);

// A bail here tells the main thread, which tells the other workers
let bailed = false;
const state = {
  get bailed() {
    return bailed;
  },
  set bailed(value: boolean) {
    if (value && !bailed) post({ type: "bail" });
    bailed = value;
  },
};

const run = await startRun(
  (workerData as { options: EngineOptions }).options,
  state,
);

// What a file writes is kept and sent with its results, the main thread
// prints it in file order. Writes outside a file go out as they happen.
let output: Output[] | null = null;

for (const stream of ["stdout", "stderr"] as const) {
  const target = process[stream];
  const write = target.write.bind(target);

  target.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    if (!output)
      return (write as (...args: unknown[]) => boolean)(chunk, ...rest);

    output.push({
      stream,
      text: typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
    });

    // The callback, if any, comes last
    const done = rest.find((arg) => typeof arg === "function");

    if (done) queueMicrotask(done as () => void);

    return true;
  }) as typeof target.write;
}

// One file at a time, in the order they came
let queue = Promise.resolve();

port.on("message", (message: ToWorker) => {
  if (message.type === "bail") {
    // Not through the setter, the main thread already knows
    bailed = true;

    return;
  }

  queue = queue.then(async () => {
    if (message.type === "file") {
      const written: Output[] = [];

      output = written;

      const result = await run.runFile(message.file);

      output = null;

      post({
        type: "file",
        index: message.index,
        run: copyFileRun(result),
        output: written,
      });
    } else {
      post({ type: "end", end: await run.finish(), bundled: bundledFiles() });
    }
  });
});

post({ type: "ready" });
