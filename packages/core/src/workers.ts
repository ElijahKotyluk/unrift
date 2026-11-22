/**
 * Runs test files in worker threads. Each worker is a separate run (see
 * startRun in run.ts) with its own module graph, mocks and globals. The
 * main thread hands out one file at a time, so a worker that finishes early
 * takes the next one, and puts the results back in the order of the files.
 */

import { Worker } from "node:worker_threads";

import type { EngineOptions, FileRun, RunEnd, RunPart } from "./run";
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
  | { type: "started"; index: number }
  | ({ type: "output"; index: number } & Output)
  | { type: "file"; index: number; run: CopiedFileRun; part: RunPart }
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
  /** The file sent to it, until its results are back. */
  sent: number | null;
  /** The file it said it started, until its results are back. */
  started: number | null;
  /** The file it finished last, late output and errors belong to it. */
  last: number | null;
  /** It said it's ready, so it got through starting up. */
  ready: boolean;
  /** Told to finish: it runs the top level's afterAll. */
  finishing: boolean;
  ended: boolean;
  /** An error it threw, handled once it has exited and sent everything. */
  error?: Error;
};

/**
 * The process's Node flags, for the workers. --input-type is for code given
 * with -e or on stdin, a worker loaded from a file can't start with it.
 */
function workerExecArgv(argv: string[]): string[] {
  const kept: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input-type") i++;
    else if (!argv[i].startsWith("--input-type=")) kept.push(argv[i]);
  }

  return kept;
}

/** The error's stack frames, without its message. */
function frames(error: Error): string {
  return (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
}

export async function runInWorkers(
  options: EngineOptions,
  count: number,
): Promise<{ files: FileRun[]; end: RunEnd }> {
  const total = options.files.length;
  const files: Array<FileRun | undefined> = Array.from({ length: total });
  const outputs: Output[][] = Array.from({ length: total }, () => []);
  let printed = 0;

  // Each file's output once it and every file before it are done, so it
  // reads like a run without workers. Output for a file already printed,
  // written after its tests, goes out right away.
  const print = () => {
    while (printed < total && files[printed]) {
      for (const { stream, bytes } of outputs[printed]) {
        process[stream].write(bytes);
      }

      outputs[printed] = [];
      printed++;
    }
  };
  const parts: RunPart[] = [];
  const roots: FileRun[] = [];
  const slots: Slot[] = [];
  // Files sent to a worker that died before starting them, they go first
  const requeued: number[] = [];
  let next = 0;
  let crashed = false;
  // Set by the worker that bails, read by every worker before each test. A
  // message would wait until a worker running synchronous tests yields.
  const bailed = new Int32Array(new SharedArrayBuffer(4));

  const nextFile = () =>
    requeued.length > 0 ? requeued.shift()! : next < total ? next++ : null;
  const more = () => requeued.length > 0 || next < total;

  try {
    await new Promise<void>((resolveRun, rejectRun) => {
      let alive = 0;
      // A worker that can't start after one did fails the run, not the files
      // the others ran
      let anyReady = false;
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
        const index = nextFile();

        if (index === null) {
          slot.finishing = true;
          slot.worker.postMessage({ type: "finish" } satisfies ToWorker);
          return;
        }

        slot.sent = index;
        slot.worker.postMessage({
          type: "file",
          index,
          file: options.files[index],
        } satisfies ToWorker);
      };

      // A failed `[worker]` result on the file it was running, or else on
      // the one it finished last: an error thrown from a timer can come after
      // a file's tests
      const fail = (slot: Slot, index: number, error: Error) => {
        const running = slot.started === index && !files[index];
        const name = options.files[index];
        const before = running && slot.last !== null ? slot.last : null;
        const message =
          `${error.message}\n\nThe worker stopped ${running ? "while running" : "after running"} ${name}.` +
          (before === null
            ? ""
            : ` It can come from ${options.files[before]}, which ran before it in the same worker.`);
        const reported = new Error(message);

        reported.stack = `Error: ${message}\n${frames(error)}`;

        const result: TestResult = {
          description: `${normalizePath(name)} > [worker]`,
          status: TaskStatus.Fail,
          error: reported,
          durationMs: 0,
        };
        const done = files[index];

        files[index] = done
          ? { ...done, results: [...done.results, result] }
          : { file: normalizePath(name), results: [result], hasOnly: false };

        // A failed file, like any other under --bail
        if (options.bail) Atomics.store(bailed, 0, 1);

        print();
      };

      // A worker that ran no file, or stopped outside one, has nothing else
      // to put it on
      const failRoot = (error: Error, why: string) => {
        const message = `${error.message}\n\n${why}`;
        const reported = new Error(message);

        reported.stack = `Error: ${message}\n${frames(error)}`;
        roots.push({
          file: "root",
          results: [
            {
              description: "root > [worker]",
              status: TaskStatus.Fail,
              error: reported,
              durationMs: 0,
            },
          ],
          hasOnly: false,
        });

        if (options.bail) Atomics.store(bailed, 0, 1);
      };

      const start = () => {
        const slot: Slot = {
          worker: new Worker(new URL("./worker.js", import.meta.url), {
            workerData: { options, bailed },
            execArgv: workerExecArgv(process.execArgv),
          }),
          sent: null,
          started: null,
          last: null,
          ready: false,
          finishing: false,
          ended: false,
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
              slot.ready = true;
              anyReady = true;
              dispatch(slot);
              break;
            case "started":
              slot.started = message.index;
              break;
            case "file":
              files[message.index] = restoreFileRun(message.run);
              parts.push(message.part);
              slot.sent = null;
              slot.started = null;
              slot.last = message.index;
              print();

              // It already threw, it's stopping
              if (!slot.error) dispatch(slot);
              break;
            case "end":
              slot.ended = true;
              parts.push(message.end);
              roots.push(restoreFileRun(message.end.root));
              addBundledFiles(message.bundled);

              if (--alive === 0) resolve();
              break;
          }
        });

        // An error a test threw from a timer. The thread stops after it, and
        // its last messages may still be on the way: handled on exit.
        slot.worker.on("error", (error) => {
          slot.error ??= error;
        });

        // After every message it sent
        slot.worker.on("exit", (code) => {
          if (settled) return;

          const error =
            slot.error ??
            new Error(`Unrift worker stopped with exit code ${code}`);

          if (slot.ended) {
            // After its last file, while other workers still run: an error a
            // timer threw, or process.exit(). Without workers it'd fail the run.
            if (slot.error || code !== 0) {
              if (slot.last !== null) fail(slot, slot.last, error);
              else failRoot(error, "The worker stopped after the run.");
            }
            return;
          }

          crashed = true;

          // Sent but never started, another worker runs it
          if (slot.sent !== null && slot.started !== slot.sent) {
            requeued.unshift(slot.sent);
          }

          const at = slot.started ?? slot.last;

          // No worker got started: the run itself can't, like a matchers
          // module that throws
          if (!anyReady) {
            reject(error);
            return;
          }

          // Outside a file: running the top level's afterAll, or starting up
          if (slot.finishing) {
            failRoot(
              error,
              "The worker stopped running the top level's afterAll." +
                (slot.last === null
                  ? ""
                  : ` It can come from ${options.files[slot.last]}, which ran before it in the same worker.`),
            );
          } else if (at === null) {
            failRoot(
              error,
              slot.ready
                ? "The worker stopped before its first file."
                : "A worker couldn't start.",
            );
          } else {
            fail(slot, at, error);
          }

          alive--;

          // Only for one that got through a file: one that stopped before
          // would only stop again, every time
          if (more() && at !== null) start();
          else if (alive === 0) resolve();
        });
      };

      for (let i = 0; i < count; i++) start();
    });
  } finally {
    // A worker that died never sent what it bundled. Watch mode watches
    // more broadly until a run gets through.
    if (crashed) addBundledFiles({ files: [], failed: true });

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
        // Left over when no worker could start to run it
        run ?? {
          file: normalizePath(options.files[i]),
          results: [
            {
              description: `${normalizePath(options.files[i])} > [worker]`,
              status: TaskStatus.Fail,
              error: new Error("Not run, no worker could start to run it."),
              durationMs: 0,
            },
          ],
          hasOnly: false,
        },
    ),
    end: {
      root: {
        file: "root",
        results: roots.flatMap((root) => root.results),
        hasOnly: false,
      },
      snapshots: mergeSnapshots(parts.map((part) => part.snapshots)),
      inline: parts.flatMap((part) => part.inline),
      emptied: parts.flatMap((part) => part.emptied),
      scripts: parts.flatMap((part) => part.scripts),
      bundles: parts.flatMap((part) => part.bundles),
    },
  };
}
