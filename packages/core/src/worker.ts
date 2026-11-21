/**
 * Entry point of a worker thread, see workers.ts. Runs the files the main
 * thread sends, one at a time, then finishes the run when told to.
 */

import { parentPort, workerData } from "node:worker_threads";

import { registerModuleLoader } from "./mock/register-loader";
import { startRun, type EngineOptions } from "./run";
import { bundledFiles } from "./utils/transform";
import { copyFileRun, type FromWorker, type ToWorker } from "./workers";

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
      const result = await run.runFile(message.file);

      post({ type: "file", index: message.index, run: copyFileRun(result) });
    } else {
      post({ type: "end", end: await run.finish(), bundled: bundledFiles() });
    }
  });
});

post({ type: "ready" });
