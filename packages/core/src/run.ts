import { pathToFileURL } from "url";

import { RunState, unriftGlobalContext } from "./context";
import { ensureInternalMatchers } from "./matchers";
import { clearContext, computeOnlyFlags, rootSuite, Suite } from "./suite";
import { TaskMode, TaskStatus } from "./types";

export type RunEngineOptions = {
  files: string[];
  timeoutMs?: number;
  bail?: boolean;
  matchers?: string[];
};

export type RunEngineResult = {
  isOnly: boolean;
  timeoutMs?: number;
  bail: boolean;
  results: Array<{
    description: string;
    status: TaskStatus;
    error?: Error;
    durationMs: number;
  }>;
};

async function loadMatcherModules(specifiers?: string[]) {
  for (const spec of specifiers ?? []) {
    await import(spec);
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function runEngine(
  options: RunEngineOptions,
): Promise<RunEngineResult> {
  const { files } = options;

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
        await import(pathToFileURL(file).href);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

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

    await rootSuite.run({ timeoutMs, bail }, { bailed: false }, isOnly, false);

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
