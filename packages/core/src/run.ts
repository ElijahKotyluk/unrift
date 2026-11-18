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
  resetSnapshots,
  type SnapshotSummary,
  type SnapshotUpdateMode,
} from "./snapshot/state";
import { startCoverage, stopCoverage, takeCoverage } from "./coverage/collect";
import { toFileCoverage, type FileCoverage } from "./coverage/convert";
import { summarize, type CoverageSummary } from "./coverage/report";

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

type RunEngineOptions = {
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

export async function runEngine(
  options: RunEngineOptions,
): Promise<RunEngineResult> {
  const { files } = options;

  // Validate before touching global state. A bad value (e.g. "3" from a JSON
  // config) would otherwise turn into "31" attempts or zero.
  assertValidRetries(options.retries, "runEngine");

  const updateMode = options.updateSnapshots ?? (isCI() ? "none" : "new");

  if (!["all", "new", "none"].includes(updateMode)) {
    throw new Error(
      `updateSnapshots must be "all", "new" or "none", got ${JSON.stringify(updateMode)}`,
    );
  }

  clearContext();
  runCount++;

  resetSnapshots(updateMode);

  ensureInternalMatchers();

  const coverage =
    options.coverage === true ? {} : options.coverage || undefined;

  // Before any user code loads, code compiled earlier isn't counted
  if (coverage) await startCoverage();
  else await stopCoverage();

  const bundles = new Set<string>();

  await loadMatcherModules(options.matchers);

  const timeoutMs = options.timeoutMs;
  const bail = options.bail ?? false;

  unriftGlobalContext.state = RunState.Register;

  try {
    for (const file of files) {
      const fileSuite = new Suite(
        normalizePath(file),
        rootSuite,
        TaskMode.Default,
      );

      rootSuite.addSuite(fileSuite);
      unriftGlobalContext.currentSuite = fileSuite;

      try {
        forgetCommonJs(file);

        const built = await toImportUrl(file, "bundle-test", {
          coverage: !!coverage,
        });
        const url = freshImportUrl(built);

        if (built !== pathToFileURL(file).href) bundles.add(url);

        await import(url);
      } catch (err) {
        const error = toError(err);

        fileSuite.errors.push({
          label: "import",
          error,
        });

        // Tests registered before the error mustn't run. The run loop goes by
        // mode, so marking statuses alone wasn't enough.
        fileSuite.mode = TaskMode.Skip;
        fileSuite.markSubtreeSkipped();
      } finally {
        unriftGlobalContext.currentSuite = rootSuite;
      }
    }

    const isOnly = computeOnlyFlags(rootSuite);

    unriftGlobalContext.state = RunState.Run;

    await rootSuite.run(
      { timeoutMs, bail, grep: options.grep, retries: options.retries },
      { bailed: false },
      isOnly,
      false,
    );

    const results = rootSuite.getResults();

    let coverageResult: RunEngineCoverage | undefined;

    if (coverage) {
      const covered = toFileCoverage(await takeCoverage(), bundles, {
        root: coverage.root ?? process.cwd(),
        include: coverage.include,
        exclude: coverage.exclude,
        testFiles: files,
      });

      coverageResult = { files: covered, summary: summarize(covered) };
    }

    // A file that failed to import never ran, leave its snapshots alone
    const snapshots = finishSnapshots(
      rootSuite.suites
        .filter((suite) => !suite.errors.some((e) => e.label === "import"))
        .map((suite) => ({
          file: suite.description,
          keep: unpassedTestNames(suite),
        })),
    );

    return {
      isOnly,
      timeoutMs,
      bail,
      results,
      snapshots,
      coverage: coverageResult,
    };
  } finally {
    unriftGlobalContext.state = RunState.Idle;
    unriftGlobalContext.currentSuite = rootSuite;
  }
}
