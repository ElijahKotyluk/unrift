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

type RunEngineOptions = {
  files: string[];
  timeoutMs?: number;
  bail?: boolean;
  grep?: RegExp;
  retries?: number;
  matchers?: string[];
  /** Defaults to "none" when the CI env var is set, otherwise "new". */
  updateSnapshots?: SnapshotUpdateMode;
};

export type RunEngineResult = {
  isOnly: boolean;
  timeoutMs?: number;
  bail: boolean;
  results: TestResult[];
  snapshots: SnapshotSummary;
};

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

  resetSnapshots(updateMode);

  ensureInternalMatchers();

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
        await import(toImportUrl(file, "bundle-test"));
      } catch (err) {
        const error = toError(err);

        fileSuite.errors.push({
          label: "import",
          error,
        });

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
    };
  } finally {
    unriftGlobalContext.state = RunState.Idle;
    unriftGlobalContext.currentSuite = rootSuite;
  }
}
