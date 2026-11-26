/**
 * Runs test files in worker threads. Each worker is a separate run (see
 * startRun in run.ts) with its own module graph, mocks and globals. The
 * main thread hands out one file at a time, so a worker that finishes early
 * takes the next one, and puts the results back in the order of the files.
 */

import { relative } from "node:path";
import { Worker } from "node:worker_threads";

import type { EngineOptions, FileRun, RunEnd, RunPart } from "./run.js";
import type { SnapshotSummary } from "./snapshot/state.js";
import type { TestResult } from "./suite.js";
import { TaskStatus } from "./types.js";
import { colors } from "./utils/colors.js";
import { normalizePath } from "./utils/normalizePath.js";
import { addBundledFiles } from "./utils/transform.js";
import { addWrites } from "./utils/ownWrites.js";

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
  /** Sending failed, it stops after this. */
  | { type: "crash"; error: CopiedError }
  /** A test called process.exit(), it stops after this. */
  | { type: "exit"; code: string }
  | {
      type: "end";
      end: Omit<RunEnd, "root"> & { root: CopiedFileRun };
      bundled: { files: string[]; failed: boolean };
    };

/** A field as text, or undefined if reading it or making it text throws. */
function text(read: () => unknown): string | undefined {
  try {
    const value = read();

    return value === undefined ? undefined : String(value);
  } catch {
    return undefined;
  }
}

/**
 * Errors are copied by hand, as text: a structured clone drops what isn't a
 * plain Error field, and a field it can't clone (a test can throw anything)
 * would throw instead.
 */
export function copyError(error: unknown): CopiedError {
  const field = (key: string) =>
    text(() => (error as Record<string, unknown>)[key]);

  return {
    name: field("name") ?? "Error",
    message: field("message") ?? text(() => error) ?? "",
    stack: field("stack"),
  };
}

export function restoreError(copied: CopiedError): Error {
  const error = new Error(copied.message);

  error.name = copied.name;
  error.stack = copied.stack;

  return error;
}

export function copyFileRun(run: FileRun): CopiedFileRun {
  return {
    ...run,
    results: run.results.map((result) => ({
      ...result,
      error: result.error && copyError(result.error),
    })),
  };
}

function restoreFileRun(run: CopiedFileRun): FileRun {
  return {
    ...run,
    results: run.results.map((result) => ({
      ...result,
      error: result.error && restoreError(result.error),
    })),
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
  /** Told to finish: its files are done. */
  finishing: boolean;
  ended: boolean;
  exited: boolean;
  /** The code a test called process.exit() with. */
  exitCalled?: string;
  /** An error it threw, handled once it has exited and sent everything. */
  error?: Error;
};

/**
 * Loads worker.js from code, not the file. A worker takes the process's Node
 * flags: --input-type, from a run started with -e or stdin, stops a worker
 * loaded from a file, and an explicit execArgv without it would turn down
 * flags like --max-old-space-size.
 */
/** How long a worker gets to exit on its own after its last file. */
const EXIT_GRACE_MS = 1000;

const WORKER_CODE = `import(${JSON.stringify(new URL("./worker.js", import.meta.url).href)})`;

/** A file as a note shows it: from the working directory if it's in it. */
function shown(file: string): string {
  const path = relative(process.cwd(), file);

  return normalizePath(path.startsWith("..") ? file : path);
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
  // The file whose late output went out last, a note marks where it starts
  let late: number | null = null;

  // Each file's output once it and every file before it are done, so it
  // reads like a run without workers. Output for a file already printed,
  // written after its tests, goes out right away.
  const print = () => {
    while (printed < total && files[printed]) {
      for (const { stream, bytes } of outputs[printed]) {
        process[stream].write(bytes);
        late = null;
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
      let grace: ReturnType<typeof setTimeout> | null = null;
      const resolve = () => {
        settled = true;
        if (grace) clearTimeout(grace);
        resolveRun();
      };
      const reject = (err: unknown) => {
        settled = true;
        if (grace) clearTimeout(grace);
        rejectRun(err);
      };

      // Every file is done. A worker exits once nothing a test left is
      // pending, so an error from a leftover timer still fails the run, like
      // without workers. One still going after a while is stopped, and says
      // which file it ran last, like Jest's "failed to exit gracefully".
      const drain = () => {
        if (slots.every((slot) => slot.exited)) {
          resolve();
          return;
        }

        grace ??= setTimeout(() => {
          for (const slot of slots) {
            if (slot.exited) continue;

            const from =
              slot.last === null
                ? ""
                : ` after ${shown(options.files[slot.last])}`;

            process.stderr.write(
              colors.yellow(
                `\nA worker was still running ${EXIT_GRACE_MS}ms${from}, a test left a timer, socket or other handle open. It was stopped.\n`,
              ),
            );
          }

          resolve();
        }, EXIT_GRACE_MS);
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
          worker: new Worker(WORKER_CODE, {
            eval: true,
            workerData: { options, bailed },
          }),
          sent: null,
          started: null,
          last: null,
          ready: false,
          finishing: false,
          ended: false,
          exited: false,
        };

        slots.push(slot);
        alive++;

        slot.worker.on("message", (message: FromWorker) => {
          switch (message.type) {
            case "output":
              if (message.index < printed) {
                // Like Jest, it says whose it is: it lands among whatever
                // prints now
                if (late !== message.index) {
                  late = message.index;
                  process.stderr.write(
                    colors.yellow(
                      `\nOutput from ${shown(options.files[message.index])} after its tests were done. Did a test leave a timer running?\n`,
                    ),
                  );
                }

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
              addWrites(message.part.writes);
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
              addWrites(message.end.writes);
              roots.push(restoreFileRun(message.end.root));
              addBundledFiles(message.bundled);

              if (--alive === 0) drain();
              break;
            case "crash":
              slot.error ??= restoreError(message.error);
              break;
            case "exit":
              slot.exitCalled = message.code;
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
          slot.exited = true;

          if (settled) return;

          const error =
            slot.error ??
            new Error(
              slot.exitCalled === undefined
                ? `Unrift worker stopped with exit code ${code}`
                : `process.exit(${slot.exitCalled}) stopped the worker`,
            );

          if (slot.ended) {
            // After its last file, while other workers still run: an error a
            // timer threw, or process.exit(). Without workers it'd fail the run.
            if (slot.error || code !== 0 || slot.exitCalled !== undefined) {
              if (slot.last !== null) fail(slot, slot.last, error);
              else failRoot(error, "The worker stopped after the run.");
            }

            if (alive === 0) drain();
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

          // Outside a file: after its last one, or starting up
          if (slot.finishing) {
            failRoot(
              error,
              "The worker stopped after its last file." +
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
          else if (alive === 0) drain();
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
      // Already added as they came in
      writes: [],
    },
  };
}
