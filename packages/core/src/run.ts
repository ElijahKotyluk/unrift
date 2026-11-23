import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  clearContext,
  computeOnlyFlags,
  rootSuite,
  runProgress,
  Suite,
  type TestResult,
} from "./suite";
import { ensureInternalMatchers } from "./matchers";
import { fileScope, RunState, unriftGlobalContext } from "./context";
import { normalizePath } from "./utils/normalizePath";
import { TaskMode, TaskStatus } from "./types";
import { toError } from "./utils/toError";
import {
  addBundledFiles,
  importGraph,
  isSharedCode,
  toImportUrl,
} from "./utils/transform";
import { takeWrites } from "./utils/ownWrites";
import { assertValidRetries } from "./utils/helpers";
import {
  finishSnapshots,
  removeEmptyDirs,
  writeInline,
  resetSnapshots,
  type SnapshotSummary,
  type SnapshotUpdateMode,
} from "./snapshot/state";
import {
  startCoverage,
  stopCoverage,
  takeCoverage,
  type V8ScriptCoverage,
} from "./coverage/collect";
import { toFileCoverage, type FileCoverage } from "./coverage/convert";
import type { InlineSource } from "./snapshot/inline";
import { summarize, type CoverageSummary } from "./coverage/report";
import { runInWorkers } from "./workers";
import { registerModuleLoader } from "./mock/register-loader";
import {
  noteLoads,
  setMatcherCopy,
  setRunGeneration,
} from "./mock/module-loader";
import { useRealTimers } from "./mock/timers";

export type RunEngineCoverageOptions = {
  /** Files outside it aren't reported. Defaults to the working directory. */
  root?: string;
  /** Only report files matching one of these globs or regexes. */
  include?: string[];
  exclude?: string[];
};

export type RunEngineCoverage = {
  files: FileCoverage[];
  summary: CoverageSummary;
};

export type RunEngineOptions = {
  files: string[];
  timeoutMs?: number;
  bail?: boolean;
  grep?: RegExp;
  retries?: number;
  matchers?: string[];
  /** Defaults to "none" when the CI env var is set, otherwise "new". */
  updateSnapshots?: SnapshotUpdateMode;
  /** Collect coverage of the files the tests ran. */
  coverage?: boolean | RunEngineCoverageOptions;
  /** Run the files in this many worker threads. Defaults to 1, no workers. */
  workers?: number;
};

export type RunEngineResult = {
  isOnly: boolean;
  timeoutMs?: number;
  bail: boolean;
  results: TestResult[];
  snapshots: SnapshotSummary;
  /** Set when coverage was asked for. */
  coverage?: RunEngineCoverage;
};

// Node caches a module by URL, so a file that didn't change would come back
// from the cache and register no tests on a second run (watch mode). Every
// run after the first gets its own URL so the file runs again. The same one
// the module hooks give the project files it imports: a helper that
// imports the test back gets this module, not a second copy.
let runCount = 0;

function freshImportUrl(url: string): string {
  return runCount > 1 ? `${url}?unrift-run=${runCount}` : url;
}

// The query string only reloads ESM. A CommonJS file (.cjs, or .js in a
// CommonJS package) is cached by filename, so drop it from that cache.
const requireCache = createRequire(import.meta.url).cache;

function forgetCommonJs(file: string) {
  for (const key of [file, safeRealpath(file)]) delete requireCache[key];
}

// Project files a test required, so a later run loads them again like the
// ESM ones (see module-loader.ts). Packages and unrift stay.
const OWN_DIR = fileURLToPath(new URL("../", import.meta.url));

function forgetProjectCommonJs() {
  for (const key of Object.keys(requireCache)) {
    if (!key.includes(`${sep}node_modules${sep}`) && !key.startsWith(OWN_DIR)) {
      delete requireCache[key];
    }
  }
}

function safeRealpath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

function isCI(): boolean {
  const ci = process.env.CI;

  return !!ci && ci !== "false" && ci !== "0";
}

/** Names of tests that didn't pass, so their unused snapshots aren't called obsolete. */
function unpassedTestNames(suite: Suite, names: string[] = []): string[] {
  for (const test of suite.tests) {
    if (test.status !== TaskStatus.Pass)
      names.push(suite.getSnapshotName(test));
  }

  for (const child of suite.suites) unpassedTestNames(child, names);

  return names;
}

// Before any test can fake them
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/**
 * How long a file may sit with nothing keeping Node going, by default.
 * UNRIFT_STALL_MS is for unrift's own tests, which stall on purpose.
 */
const STALL_MS = Number(process.env.UNRIFT_STALL_MS) || 5000;

class Stalled extends Error {
  constructor(ms: number) {
    super(
      `Nothing kept Node going for ${ms}ms and it didn't finish: it waits on a promise nothing settles, or only on an unref'd timer or handle. A longer timeoutMs gives that one longer.`,
    );
    this.name = "Stalled";
  }
}

/**
 * The promise, or a Stalled error once it's clear nothing will settle it.
 * Without this, a hook or test awaiting such a promise would let Node exit
 * as if the run passed, or keep a worker waiting forever.
 *
 * Node says nothing keeps it going with beforeExit (a worker's port is
 * unref'd while it runs a file). An unref'd timer doesn't, and may still
 * settle it, so Node is kept going for a while first. Any hook or test that
 * finishes in that time starts it over.
 */
function settles<T>(work: Promise<T>, ms = STALL_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The wait ran out with nothing moved. Only if Node is still idle then
  // (beforeExit again) is it stuck: the timer may have started real work.
  let elapsed = false;
  let from = 0;
  let onExit: () => void = () => {};
  const stalled = new Promise<never>((_, reject) => {
    onExit = () => {
      if (timer) return;

      if (elapsed && runProgress() === from) {
        reject(new Stalled(ms));
        return;
      }

      elapsed = false;
      from = runProgress();
      timer = realSetTimeout(() => {
        timer = null;
        // Something moved, it's not stuck. If Node drains again, beforeExit
        // starts another wait.
        elapsed = runProgress() === from;
      }, ms);
    };
    process.on("beforeExit", onExit);
  });

  return Promise.race([work, stalled]).finally(() => {
    process.off("beforeExit", onExit);
    if (timer) realClearTimeout(timer);
  });
}

/** Fails the tests still running in it, whether there were any. */
function failRunning(suite: Suite, error: Error): boolean {
  let found = false;

  for (const test of suite.tests) {
    if (test.status === TaskStatus.Running) {
      test.status = TaskStatus.Fail;
      test.error = error;
      found = true;
    }
  }

  for (const child of suite.suites) {
    if (failRunning(child, error)) found = true;
  }

  return found;
}

/** A matchers module, and the file it is if it's one. */
type Matcher = { spec: string; url: string; file: string | null };

/**
 * Resolves the matchers modules. A relative path is from the working
 * directory, the CLI passes them from the config's folder. Node loads them
 * like a test file it doesn't bundle, they share its modules.
 */
function resolveMatchers(specifiers: string[] | undefined): Matcher[] {
  // Not through the hooks, which would hand back a run's or a file's copy
  setMatcherCopy(new Set(), null);

  // A module listed twice is one module, its hooks are added once
  return [...new Set(specifiers ?? [])].map((spec) => {
    const url =
      spec.startsWith(".") || isAbsolute(spec)
        ? // The real path, what Node resolves an import of it to
          pathToFileURL(safeRealpath(resolvePath(spec))).href
        : import.meta.resolve(spec).replace(/[?#].*$/, "");

    return {
      spec,
      url,
      file: url.startsWith("file:") ? fileURLToPath(url) : null,
    };
  });
}

/** The options a worker gets, all of them can be copied to another thread. */
export type EngineOptions = Omit<RunEngineOptions, "workers">;

export type FileRun = {
  file: string;
  results: TestResult[];
  /** The file has `.only`, so its other tests were skipped. */
  hasOnly: boolean;
};

/** What a run's finished files leave besides their results. */
export type RunPart = {
  snapshots: SnapshotSummary;
  /** Inline snapshot edits, not written yet. */
  inline: InlineSource[];
  /** Snapshot dirs to remove if they're empty, once every thread is done. */
  emptied: string[];
  /** V8 coverage of the run's own code, empty without coverage. */
  scripts: V8ScriptCoverage[];
  /** URLs of the test bundles, for coverage. */
  bundles: string[];
  /** Files written and their stamps, for watch mode in the main thread. */
  writes: Array<[string, string]>;
};

export type RunEnd = RunPart & {
  /** Results for the top level's beforeAll and afterAll, if they failed. */
  root: FileRun;
};

function snapshotMode(options: EngineOptions): SnapshotUpdateMode {
  const updateMode = options.updateSnapshots ?? (isCI() ? "none" : "new");

  if (!["all", "new", "none"].includes(updateMode)) {
    throw new Error(
      `updateSnapshots must be "all", "new" or "none", got ${JSON.stringify(updateMode)}`,
    );
  }

  return updateMode;
}

function workerCount(workers: unknown): number {
  if (workers === undefined) return 1;

  if (
    typeof workers !== "number" ||
    !Number.isInteger(workers) ||
    workers < 1
  ) {
    throw new Error(
      `workers must be a whole number of 1 or more, got ${JSON.stringify(workers)}`,
    );
  }

  return workers;
}

function coverageOptions(
  options: EngineOptions,
): RunEngineCoverageOptions | undefined {
  return options.coverage === true ? {} : options.coverage || undefined;
}

/**
 * A run in this thread: `runFile` for each test file, then `finish` once.
 * A worker thread starts one and runs the files the main thread sends it.
 *
 * `state.bailed` stops the run, a worker sets it when another one bails.
 */
export async function startRun(
  options: EngineOptions,
  state: { bailed: boolean } = { bailed: false },
) {
  clearContext();
  runCount++;
  // A worker thread has them already, the main thread may not without the CLI
  registerModuleLoader();
  setRunGeneration(runCount);
  if (runCount > 1) forgetProjectCommonJs();

  resetSnapshots(snapshotMode(options));

  ensureInternalMatchers();

  const coverage = coverageOptions(options);

  // Before any user code loads, code compiled earlier isn't counted
  if (coverage) await startCoverage();
  else await stopCoverage();

  const bundles = new Set<string>();
  // Bundled since the last take
  let newBundles: string[] = [];

  const matchers = resolveMatchers(options.matchers);
  const matcherFiles = matchers.flatMap((m) => (m.file ? [m.file] : []));
  // The matchers modules and the project files Node loads with them. Test
  // bundles leave them out, so a bundled test shares them like one Node
  // loads does, like in Jest and Vitest.
  // Grows with what Node loads when it imports them, like an awaited
  // import() at their top level
  const sharedFiles = new Set([
    ...matcherFiles,
    ...(
      await Promise.all(
        matchers.flatMap((m) =>
          m.file && !m.file.includes(`${sep}node_modules${sep}`)
            ? [importGraph(m.file)]
            : [],
        ),
      )
    ).flat(),
  ]);
  const matcherUrls = new Set(matchers.map((m) => m.url));

  // Watched like a test's imports
  addBundledFiles({
    files: [...sharedFiles].filter(
      (f) => !f.includes(`${sep}node_modules${sep}`),
    ),
    failed: false,
  });
  // Each file gets its own copy of the matchers modules
  let fileCount = 0;

  /** Imports the file, which registers its tests, and runs them. */
  async function runFile(file: string): Promise<FileRun> {
    const fileSuite = new Suite(
      normalizePath(file),
      rootSuite,
      TaskMode.Default,
    );

    rootSuite.addSuite(fileSuite);

    // A test timeout says how long something may take, otherwise a while
    const stallMs = options.timeoutMs ?? STALL_MS;
    // The run's state as this file sees it: a stall gives up on it alone
    const fileState = {
      get bailed() {
        return state.bailed;
      },
      set bailed(value: boolean) {
        state.bailed = value;
      },
      abandoned: false,
    };

    // Its code knows it's this file's, even once it's given up on
    return fileScope.run(fileState, () =>
      runFileIn(file, fileSuite, fileState, stallMs),
    );
  }

  async function runFileIn(
    file: string,
    fileSuite: Suite,
    fileState: { bailed: boolean; abandoned: boolean },
    stallMs: number,
  ): Promise<FileRun> {
    unriftGlobalContext.currentSuite = fileSuite;
    unriftGlobalContext.state = RunState.Register;

    try {
      try {
        forgetCommonJs(file);

        // Imported for each file, like a setup file in Jest and Vitest, so
        // the hooks it adds at the top level are this file's and run before
        // its own. A test that imports it gets this same copy.
        const copy = `unrift-file=${runCount}.${++fileCount}`;

        setMatcherCopy(matcherUrls, copy);

        // A CommonJS one runs again only once it's out of the cache. A
        // require() of it in the test then gets this copy too.
        for (const f of matcherFiles) forgetCommonJs(f);

        noteLoads(true);

        try {
          for (const m of matchers) {
            await settles(import(`${m.url}?${copy}`), stallMs);

            if (fileSuite.tests.length > 0 || fileSuite.suites.length > 0) {
              // They aren't the file's, only the error is
              fileSuite.tests.length = 0;
              fileSuite.suites.length = 0;

              throw new Error(
                `Unrift: matchers module ${m.spec} defined tests. It can add matchers and hooks, put tests in a test file.`,
              );
            }
          }
        } finally {
          // What Node loaded with them, it can load again for a test
          const loaded: string[] = [];

          for (const url of noteLoads(false)) {
            if (!url.startsWith("file:")) continue;

            const path = fileURLToPath(url);

            loaded.push(path);
            if (isSharedCode(path)) sharedFiles.add(path);
          }

          // Watched like what they import statically
          addBundledFiles({ files: loaded, failed: false });
        }

        const built = await toImportUrl(file, "bundle-test", {
          coverage: !!coverage,
          shared: [...sharedFiles],
        });
        const url = freshImportUrl(built);

        if (built !== pathToFileURL(file).href) {
          bundles.add(url);
          newBundles.push(url);
        }

        await settles(import(url), stallMs);
      } catch (err) {
        fileSuite.errors.push({ label: "import", error: toError(err) });

        // What it registers if it resumes goes nowhere
        if (err instanceof Stalled) fileState.abandoned = true;

        // A failed file, like any other under --bail
        if (options.bail) state.bailed = true;

        // Tests registered before the error mustn't run. The run loop goes by
        // mode, so marking statuses alone wasn't enough.
        fileSuite.mode = TaskMode.Skip;
        fileSuite.markSubtreeSkipped();
      } finally {
        unriftGlobalContext.currentSuite = rootSuite;
      }

      // Per file, like Jest and Vitest: `.only` skips the file's other tests
      const hasOnly = computeOnlyFlags(fileSuite);
      const runOptions = {
        timeoutMs: options.timeoutMs,
        bail: options.bail ?? false,
        grep: options.grep,
        retries: options.retries,
      };

      unriftGlobalContext.state = RunState.Run;

      try {
        await settles(
          fileSuite.run(runOptions, fileState, hasOnly, false),
          stallMs,
        );
      } catch (err) {
        if (!(err instanceof Stalled)) throw err;

        // Nothing more of it runs, even if what it waited on settles later
        // in another file's time
        fileState.abandoned = true;

        // The test it was in fails, or the file if it was in a hook. The
        // ones it didn't get to are skipped.
        if (!failRunning(fileSuite, err)) {
          fileSuite.errors.push({ label: "stalled", error: err });
        }

        fileSuite.markSubtreeSkipped();

        // A failure like any other under --bail
        if (options.bail) state.bailed = true;
      }

      return {
        file: fileSuite.description,
        results: fileSuite.getResults(),
        hasOnly,
      };
    } finally {
      unriftGlobalContext.state = RunState.Idle;
      // Fake timers a test left on are this file's, the next one gets real
      // ones like in Jest and Vitest
      useRealTimers();
    }
  }

  /**
   * Writes the run's snapshot files and takes its coverage. Inline snapshots
   * are written by runEngine, once every thread's edits are in.
   */
  // How many of rootSuite.suites `take` has handled
  let taken = 0;

  /**
   * Writes the snapshot files of the files run since the last take, and
   * takes their inline edits. A worker takes after each file, so a crash
   * later on doesn't lose them. Coverage is taken once, in finish.
   */
  function take(): RunPart {
    const suites = rootSuite.suites.slice(taken);

    taken = rootSuite.suites.length;

    // A file that failed to import never ran, leave its snapshots alone
    const {
      summary: snapshots,
      inline,
      emptied,
    } = finishSnapshots(
      suites
        .filter((suite) => !suite.errors.some((e) => e.label === "import"))
        .map((suite) => ({
          file: suite.description,
          keep: unpassedTestNames(suite),
        })),
    );
    const fresh = newBundles;

    newBundles = [];

    // Synchronous: nothing a test left, like a timer, can run between
    // writing the snapshot files and the worker sending what it wrote
    return {
      snapshots,
      inline,
      emptied,
      scripts: [],
      bundles: fresh,
      writes: takeWrites(),
    };
  }

  /** Takes what's left, and the coverage. */
  async function finish(): Promise<RunEnd> {
    return {
      // The top level's own errors
      root: {
        file: rootSuite.description,
        results: rootSuite.getResults().slice(0, rootSuite.errors.length),
        hasOnly: false,
      },
      ...take(),
      // Once at the end, a take per file adds up over many files. Packages
      // are never reported, leave them out.
      scripts: coverage
        ? (await takeCoverage()).filter(
            (script) =>
              bundles.has(script.url) ||
              (script.url.startsWith("file:") &&
                !script.url.includes("/node_modules/")),
          )
        : [],
    };
  }

  return { runFile, take, finish };
}

export async function runEngine(
  options: RunEngineOptions,
): Promise<RunEngineResult> {
  // Before touching global state. A bad value (e.g. "3" from a JSON config)
  // would otherwise turn into "31" attempts or zero.
  assertValidRetries(options.retries, "runEngine");
  snapshotMode(options);

  const workers = workerCount(options.workers);

  let files: FileRun[];
  let end: RunEnd;

  // Asked for workers, a single matching file still gets one. Running it here
  // instead would change what isolation and process.exit() do.
  if (workers > 1 && options.files.length > 0) {
    // The workers collect their own, a session left on here from an
    // earlier run would only slow this thread down
    await stopCoverage();

    ({ files, end } = await runInWorkers(
      options,
      Math.min(workers, options.files.length),
    ));
  } else {
    const run = await startRun(options);

    files = [];
    for (const file of options.files) files.push(await run.runFile(file));
    end = await run.finish();
  }

  const coverage = coverageOptions(options);
  let coverageResult: RunEngineCoverage | undefined;

  if (coverage) {
    const covered = toFileCoverage(end.scripts, new Set(end.bundles), {
      root: coverage.root ?? process.cwd(),
      include: coverage.include,
      exclude: coverage.exclude,
      testFiles: options.files,
    });

    coverageResult = { files: covered, summary: summarize(covered) };
  }

  // After coverage: it reads plain JS files from disk, and an inline
  // snapshot written first would move the code it ran
  const { summary: snapshots, conflicts } = writeInline(
    end.snapshots,
    end.inline,
  );

  // A test that failed for this is a failed snapshot too, like one that
  // failed inside its worker
  const byId = new Map(
    files.flatMap((file) => file.results).map((result) => [result.id, result]),
  );

  // One per test and spot, like a matcher call that fails in a worker
  for (const { test, message } of conflicts) {
    snapshots.failed++;

    const result = byId.get(test);

    if (!result) continue;

    // A test that already failed keeps its own error
    if (result.status !== TaskStatus.Fail) result.error = new Error(message);

    result.status = TaskStatus.Fail;
  }

  removeEmptyDirs(end.emptied);

  return {
    isOnly: files.some((file) => file.hasOnly),
    timeoutMs: options.timeoutMs,
    bail: options.bail ?? false,
    results: [end.root, ...files].flatMap((file) => file.results),
    snapshots,
    coverage: coverageResult,
  };
}
