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
import { TaskMode } from "./types";
import { toError } from "./utils/toError";
import { toImportUrl } from "./utils/transform";
import { assertValidRetries } from "./utils/helpers";

type RunEngineOptions = {
  files: string[];
  timeoutMs?: number;
  bail?: boolean;
  grep?: RegExp;
  retries?: number;
  matchers?: string[];
};

export type RunEngineResult = {
  isOnly: boolean;
  timeoutMs?: number;
  bail: boolean;
  results: TestResult[];
};

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

  clearContext();

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

    return {
      isOnly,
      timeoutMs,
      bail,
      results,
    };
  } finally {
    unriftGlobalContext.state = RunState.Idle;
    unriftGlobalContext.currentSuite = rootSuite;
  }
}
