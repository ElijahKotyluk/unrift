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
import { TaskStatus } from "./types";
import { normalizePath } from "./utils/normalizePath";
import { addBundledFiles } from "./utils/transform";

/** A write to stdout or stderr while a file ran. */
type Output = { stream: "stdout" | "stderr"; bytes: Uint8Array };

type CopiedError = { name: string; message: string; stack?: string };

type CopiedFileRun = Omit<FileRun, "results"> & {
  results: Array<Omit<TestResult, "error"> & { error?: CopiedError }>;
};

/** Main thread to worker. */
export type ToWorker =
  | { type: "file"; index: number; file: string }
  | { type: "finish" };

/** Worker to main thread. */
export type FromWorker =
  | { type: "ready" }
  | ({ type: "output"; index: number } & Output)
  | { type: "file"; index: number; run: CopiedFileRun }
  | {
      type: "end";
      end: Omit<RunEnd, "root"> & { root: CopiedFileRun };
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

// Sorted, the order workers finish in would change it from run to run
function mergeSnapshots(summaries: SnapshotSummary[]): SnapshotSummary {
  const byFile = <T extends { file: string }>(a: T, b: T) =>
    a.file.localeCompare(b.file);

  return {
    added: summaries.reduce((n, s) => n + s.added, 0),
    updated: summaries.reduce((n, s) => n + s.updated, 0),
    failed: summaries.reduce((n, s) => n + s.failed, 0),
    obsolete: summaries.reduce((n, s) => n + s.obsolete, 0),
    removed: summaries.reduce((n, s) => n + s.removed, 0),
    obsoleteKeys: summaries
      .flatMap((s) => s.obsoleteKeys)
      .sort((a, b) => byFile(a, b) || a.key.localeCompare(b.key)),
    filesWritten: summaries.flatMap((s) => s.filesWritten).sort(),
    inlineSkipped: summaries.flatMap((s) => s.inlineSkipped).sort(),
    errors: summaries.flatMap((s) => s.errors).sort(byFile),
  };
}

/** One worker, and where it is in the files. */
type Slot = {
  worker: Worker;
  /** The file it's running. */
  running: number | null;
  /** The file it ran last, late output and errors belong to it. */
  last: number | null;
  ended: boolean;
  crashed: boolean;
};

export async function runInWorkers(
  options: EngineOptions,
  count: number,
): Promise<{ files: FileRun[]; end: RunEnd }> {
  const files: Array<FileRun | undefined> = new Array(options.files.length);
  const outputs: Output[][] = options.files.map(() => []);
  let printed = 0;

  // Each file's output once it and every file before it are done, so it
  // reads like a run without workers. Output for a file already printed,
  // written after its tests, goes out right away.
  const print = () => {
    while (printed < outputs.length && files[printed]) {
      for (const { stream, bytes } of outputs[printed]) {
        process[stream].write(bytes);
      }

      outputs[printed] = [];
      printed++;
    }
  };
  const ends: Array<Omit<RunEnd, "root"> & { root: FileRun }> = [];
  const slots: Slot[] = [];
  let next = 0;
  let crashed = false;
  // Set by the worker that bails, read by every worker before each test. A
  // message would wait until a worker running synchronous tests yields.
  const bailed = new Int32Array(new SharedArrayBuffer(4));

  try {
    await new Promise<void>((resolveRun, rejectRun) => {
      let alive = 0;
      // Once it's over no new worker starts, cleanup is stopping them
      let settled = false;
      const resolve = () => {
        settled = true;
        resolveRun();
      };
      const reject = (err: unknown) => {
        settled = true;
        rejectRun(err);
      };

      const dispatch = (slot: Slot) => {
        if (next < options.files.length) {
          slot.running = next;
          slot.worker.postMessage({
            type: "file",
            index: next,
            file: options.files[next],
          } satisfies ToWorker);
          next++;
        } else {
          slot.worker.postMessage({ type: "finish" } satisfies ToWorker);
        }
      };

      // The file it was running fails, or the last one it ran: an error
      // thrown from a timer can come after the file's tests
      const fail = (slot: Slot, error: Error) => {
        const index = slot.running ?? slot.last;

        if (index === null) return false;

        const file = normalizePath(options.files[index]);
        const result: TestResult = {
          description: `${file} > [worker]`,
          status: TaskStatus.Fail,
          error,
          durationMs: 0,
        };
        const done = slot.running === null ? files[index] : undefined;

        // A failed file, like any other under --bail
        if (options.bail) Atomics.store(bailed, 0, 1);

        files[index] = done
          ? { ...done, results: [...done.results, result] }
          : { file, results: [result], hasOnly: false };
        print();

        return true;
      };

      const start = () => {
        const slot: Slot = {
          worker: new Worker(new URL("./worker.js", import.meta.url), {
            workerData: { options, bailed },
          }),
          running: null,
          last: null,
          ended: false,
          crashed: false,
        };

        slots.push(slot);
        alive++;

        slot.worker.on("message", (message: FromWorker) => {
          switch (message.type) {
            case "output":
              if (message.index < printed) {
                process[message.stream].write(message.bytes);
              } else {
                outputs[message.index].push(message);
              }
              break;
            case "ready":
              dispatch(slot);
              break;
            case "file":
              files[message.index] = restoreFileRun(message.run);
              slot.running = null;
              slot.last = message.index;
              print();
              dispatch(slot);
              break;
            case "end":
              slot.ended = true;
              ends.push({
                ...message.end,
                root: restoreFileRun(message.end.root),
              });
              addBundledFiles(message.bundled);

              if (--alive === 0) resolve();
              break;
          }
        });

        // An error a test threw from a timer, the thread stops after it
        slot.worker.on("error", (error) => {
          if (slot.crashed || settled) return;

          slot.crashed = true;

          // Before its first file: the run itself can't start, like a
          // matchers module that throws
          if (!fail(slot, error)) reject(error);
        });

        slot.worker.on("exit", (code) => {
          if (slot.ended || settled) return;

          if (!slot.crashed) {
            slot.crashed = true;

            const at = slot.running ?? slot.last;
            const error = new Error(
              `Unrift worker stopped with exit code ${code}` +
                (at === null ? "" : ` while running ${options.files[at]}`),
            );

            if (!fail(slot, error)) {
              reject(error);
              return;
            }
          }

          // Its files are done or failed, a new worker takes the rest
          crashed = true;
          alive--;

          if (next < options.files.length) start();
          else if (alive === 0) resolve();
        });
      };

      for (let i = 0; i < count; i++) start();
    });
  } finally {
    // A worker that died never sent what it bundled. Watch mode watches
    // more broadly until a run gets through.
    if (crashed || slots.some((slot) => slot.crashed)) {
      addBundledFiles({ files: [], failed: true });
    }

    // Whatever the files wrote helps find out why a run failed
    for (const written of outputs.slice(printed)) {
      for (const { stream, bytes } of written) process[stream].write(bytes);
    }

    // A test can leave a timer or socket open, that mustn't keep the run going
    await Promise.all(slots.map((slot) => slot.worker.terminate()));
  }

  return {
    files: files.map(
      (run, i) =>
        run ?? {
          file: normalizePath(options.files[i]),
          results: [],
          hasOnly: false,
        },
    ),
    end: {
      root: {
        file: "root",
        results: ends.flatMap((end) => end.root.results),
        hasOnly: false,
      },
      snapshots: mergeSnapshots(ends.map((end) => end.snapshots)),
      inline: ends.flatMap((end) => end.inline),
      emptied: ends.flatMap((end) => end.emptied),
      scripts: ends.flatMap((end) => end.scripts),
      bundles: ends.flatMap((end) => end.bundles),
    },
  };
}
