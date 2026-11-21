import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  clearContext,
  computeOnlyFlags,
  rootSuite,
  Suite,
  type TestResult,
} from "./suite";
import { ensureInternalMatchers } from "./matchers";
import { RunState, unriftGlobalContext } from "./context";
import { normalizePath } from "./utils/normalizePath";
import { TaskMode, TaskStatus } from "./types";
import { toError } from "./utils/toError";
import { toImportUrl } from "./utils/transform";
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
// run after the first gets its own URL so the file runs again.
let runCount = 0;

function freshImportUrl(url: string): string {
  return runCount > 1 ? `${url}?run=${runCount}` : url;
}

// The query string only reloads ESM. A CommonJS file (.cjs, or .js in a
// CommonJS package) is cached by filename, so drop it from that cache.
const requireCache = createRequire(import.meta.url).cache;

function forgetCommonJs(file: string) {
  for (const key of [file, safeRealpath(file)]) delete requireCache[key];
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

async function loadMatcherModules(specifiers?: string[]) {
  for (const spec of specifiers ?? []) {
    await import(spec);
  }
}

/** The options a worker gets, all of them can be copied to another thread. */
export type EngineOptions = Omit<RunEngineOptions, "workers">;

export type FileRun = {
  file: string;
  results: TestResult[];
  /** The file has `.only`, so its other tests were skipped. */
  hasOnly: boolean;
};

export type RunEnd = {
  /** Results for the top level's beforeAll and afterAll, if they failed. */
  root: FileRun;
  snapshots: SnapshotSummary;
  /** Inline snapshot edits, not written yet. */
  inline: InlineSource[];
  /** Snapshot dirs to remove if they're empty, once every thread is done. */
  emptied: string[];
  /** V8 coverage of the run's own code, empty without coverage. */
  scripts: V8ScriptCoverage[];
  /** URLs of the test bundles, for coverage. */
  bundles: string[];
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

  resetSnapshots(snapshotMode(options));

  ensureInternalMatchers();

  const coverage = coverageOptions(options);

  // Before any user code loads, code compiled earlier isn't counted
  if (coverage) await startCoverage();
  else await stopCoverage();

  const bundles = new Set<string>();

  await loadMatcherModules(options.matchers);

  // Hooks a matchers module adds at the top level are the run's own. Its
  // beforeEach and afterEach reach each test through the parent chain, its
  // beforeAll and afterAll run here, once per thread.
  try {
    unriftGlobalContext.state = RunState.Run;

    for (const hook of rootSuite.beforeAllHooks) await hook();
  } catch (err) {
    rootSuite.beforeAllError = toError(err);
  } finally {
    unriftGlobalContext.state = RunState.Idle;
  }

  /** Imports the file, which registers its tests, and runs them. */
  async function runFile(file: string): Promise<FileRun> {
    const fileSuite = new Suite(
      normalizePath(file),
      rootSuite,
      TaskMode.Default,
    );

    rootSuite.addSuite(fileSuite);
    unriftGlobalContext.currentSuite = fileSuite;
    unriftGlobalContext.state = RunState.Register;

    try {
      try {
        forgetCommonJs(file);

        const built = await toImportUrl(file, "bundle-test", {
          coverage: !!coverage,
        });
        const url = freshImportUrl(built);

        if (built !== pathToFileURL(file).href) bundles.add(url);

        await import(url);
      } catch (err) {
        fileSuite.errors.push({ label: "import", error: toError(err) });

        // Tests registered before the error mustn't run. The run loop goes by
        // mode, so marking statuses alone wasn't enough.
        fileSuite.mode = TaskMode.Skip;
        fileSuite.markSubtreeSkipped();
      } finally {
        unriftGlobalContext.currentSuite = rootSuite;
      }

      // Per file, like Jest and Vitest: `.only` skips the file's other tests
      const hasOnly = computeOnlyFlags(fileSuite);

      unriftGlobalContext.state = RunState.Run;

      // Like a suite whose beforeAll failed, nothing under it runs
      if (rootSuite.beforeAllError) fileSuite.markSubtreeSkipped();
      else
        await fileSuite.run(
          {
            timeoutMs: options.timeoutMs,
            bail: options.bail ?? false,
            grep: options.grep,
            retries: options.retries,
          },
          state,
          hasOnly,
          false,
        );

      return {
        file: fileSuite.description,
        results: fileSuite.getResults(),
        hasOnly,
      };
    } finally {
      unriftGlobalContext.state = RunState.Idle;
    }
  }

  /**
   * Writes the run's snapshot files and takes its coverage. Inline snapshots
   * are written by runEngine, once every thread's edits are in.
   */
  async function finish(): Promise<RunEnd> {
    if (!rootSuite.beforeAllError) {
      try {
        unriftGlobalContext.state = RunState.Run;

        for (const hook of rootSuite.afterAllHooks) await hook();
      } catch (err) {
        rootSuite.afterAllError = toError(err);
      } finally {
        unriftGlobalContext.state = RunState.Idle;
      }
    }

    // A file that failed to import never ran, leave its snapshots alone
    const {
      summary: snapshots,
      inline,
      emptied,
    } = finishSnapshots(
      rootSuite.suites
        .filter((suite) => !suite.errors.some((e) => e.label === "import"))
        .map((suite) => ({
          file: suite.description,
          keep: unpassedTestNames(suite),
        })),
    );

    // Packages are never reported, leave them out
    const scripts = coverage
      ? (await takeCoverage()).filter(
          (script) =>
            bundles.has(script.url) ||
            (script.url.startsWith("file:") &&
              !script.url.includes("/node_modules/")),
        )
      : [];

    return {
      // The top level's own errors, a failed beforeAll or afterAll
      root: {
        file: rootSuite.description,
        results: rootSuite.getResults().slice(0, rootErrorCount()),
        hasOnly: false,
      },
      snapshots,
      inline,
      emptied,
      scripts,
      bundles: [...bundles],
    };
  }

  return { runFile, finish };
}

/** How many of the root suite's results are its own, before its files'. */
function rootErrorCount(): number {
  return (
    rootSuite.errors.length +
    (rootSuite.beforeAllError ? 1 : 0) +
    (rootSuite.afterAllError ? 1 : 0)
  );
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
