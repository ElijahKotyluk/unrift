/**
 * Runs test files in worker threads. Each worker is a separate run (see
 * startRun in run.ts) with its own module graph, mocks and globals. The
 * main thread hands out one file at a time, so a worker that finishes early
 * takes the next one, and puts the results back in the order of the files.
 */

import { Worker } from "node:worker_threads";

import type { EngineOptions, FileRun, RunEnd } from "./run";
import type { SnapshotSummary } from "./snapshot/state";
import type { TestResult } from "./suite";
import { addBundledFiles } from "./utils/transform";

type CopiedError = { name: string; message: string; stack?: string };

type CopiedFileRun = Omit<FileRun, "results"> & {
  results: Array<Omit<TestResult, "error"> & { error?: CopiedError }>;
};

/** Main thread to worker. */
export type ToWorker =
  | { type: "file"; index: number; file: string }
  | { type: "bail" }
  | { type: "finish" };

/** Worker to main thread. */
export type FromWorker =
  | { type: "ready" }
  | { type: "file"; index: number; run: CopiedFileRun }
  | { type: "bail" }
  | {
      type: "end";
      end: RunEnd;
      bundled: { files: string[]; failed: boolean };
    };

/**
 * Errors are copied by hand: a structured clone drops what isn't a plain
 * Error field, and a property it can't clone would throw instead.
 */
export function copyFileRun(run: FileRun): CopiedFileRun {
  return {
    ...run,
    results: run.results.map((result) => ({
      ...result,
      error: result.error && {
        name: result.error.name,
        message: result.error.message,
        stack: result.error.stack,
      },
    })),
  };
}

function restoreFileRun(run: CopiedFileRun): FileRun {
  return {
    ...run,
    results: run.results.map((result) => {
      if (!result.error) return { ...result, error: undefined };

      const error = new Error(result.error.message);

      error.name = result.error.name;
      error.stack = result.error.stack;

      return { ...result, error };
    }),
  };
}

function mergeSnapshots(summaries: SnapshotSummary[]): SnapshotSummary {
  return {
    added: summaries.reduce((n, s) => n + s.added, 0),
    updated: summaries.reduce((n, s) => n + s.updated, 0),
    failed: summaries.reduce((n, s) => n + s.failed, 0),
    obsolete: summaries.reduce((n, s) => n + s.obsolete, 0),
    removed: summaries.reduce((n, s) => n + s.removed, 0),
    obsoleteKeys: summaries.flatMap((s) => s.obsoleteKeys),
    filesWritten: summaries.flatMap((s) => s.filesWritten),
    inlineSkipped: summaries.flatMap((s) => s.inlineSkipped),
    errors: summaries.flatMap((s) => s.errors),
  };
}

export async function runInWorkers(
  options: EngineOptions,
  count: number,
): Promise<{ files: FileRun[]; end: RunEnd }> {
  const files: FileRun[] = new Array(options.files.length);
  const ends: Array<{ end: RunEnd }> = [];
  const workers: Worker[] = [];
  let next = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let running = count;

      const send = (worker: Worker, message: ToWorker) =>
        worker.postMessage(message);

      const dispatch = (worker: Worker) => {
        if (next < options.files.length) {
          send(worker, {
            type: "file",
            index: next,
            file: options.files[next],
          });
          next++;
        } else {
          send(worker, { type: "finish" });
        }
      };

      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL("./worker.js", import.meta.url), {
          workerData: { options },
        });

        workers.push(worker);

        let ended = false;

        worker.on("message", (message: FromWorker) => {
          switch (message.type) {
            case "ready":
              dispatch(worker);
              break;
            case "file":
              files[message.index] = restoreFileRun(message.run);
              dispatch(worker);
              break;
            case "bail":
              // The rest still load and report their tests as skipped
              for (const other of workers) {
                if (other !== worker) send(other, { type: "bail" });
              }
              break;
            case "end":
              ended = true;
              ends.push({ end: message.end });
              addBundledFiles(message.bundled);

              if (--running === 0) resolve();
              break;
          }
        });

        worker.on("error", reject);
        worker.on("exit", (code) => {
          // A test called process.exit(), or the thread ran out of memory
          if (!ended) {
            reject(
              new Error(
                `Unrift worker stopped with exit code ${code} before it finished`,
              ),
            );
          }
        });
      }
    });
  } finally {
    // A test can leave a timer or socket open, that mustn't keep the run going
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  return {
    files,
    end: {
      snapshots: mergeSnapshots(ends.map(({ end }) => end.snapshots)),
      scripts: ends.flatMap(({ end }) => end.scripts),
      bundles: ends.flatMap(({ end }) => end.bundles),
    },
  };
}
