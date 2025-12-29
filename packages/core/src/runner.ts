import chalk from "chalk";
import { resolve } from "path";

import { loadConfig, loadConfigFromPath } from "./utils/loadConfig";
import { TaskStatus } from "./types";

import { discoverTestFiles } from "./utils/discoverTestFiles";
import { runEngine } from "./run";

interface RunnerOptions {
  configPath?: string;
  testDir?: string;
  pattern?: RegExp;
  timeoutMs?: number;
  bail?: boolean;
  debug?: boolean;
  list?: boolean;
  json?: boolean;
}

type JsonReport = {
  ok: boolean;
  failed: number;
  passed: number;
  skipped: number;
  total: number;
  bail: boolean;
  timeoutMs?: number;
  testDir: string;
  configPath?: string | null;
  files: string[];
  durationMs: number;
  results: Array<{
    description: string;
    status: TaskStatus;
    durationMs: number;
    error?: { message: string; stack?: string };
  }>;
};

function debugLog(enabled: boolean | undefined, ...args: unknown[]) {
  if (enabled) console.log(...args);
}

function normalizePath(path: string): string {
  // stable for regex matching across platforms
  return path.replace(/\\/g, "/");
}

function safeRegExp(str: string): RegExp {
  try {
    return new RegExp(str);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex "${str}": ${msg}`);
  }
}

function matchesAnyPattern(file: string, patterns: string[]): boolean {
  const normalized = normalizePath(file);

  return patterns.some((pattern) => safeRegExp(pattern).test(normalized));
}

function filterByIncludesExcludes(
  files: string[],
  includes?: string[],
  excludes?: string[],
): string[] {
  let filtered = files;

  if (includes && includes.length > 0) {
    filtered = filtered.filter((file) => matchesAnyPattern(file, includes));
  }

  if (excludes && excludes.length > 0) {
    filtered = filtered.filter((file) => !matchesAnyPattern(file, excludes));
  }

  return filtered;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;

  return `${(ms / 1000).toFixed(2)}s`;
}

function padRight(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function getFileHeadingFromDescription(description: string): string | null {
  const index = description.indexOf("›");

  if (index === -1) return null;

  return description.slice(0, index).trim();
}

async function runTestsCLI(options: RunnerOptions = {}) {
  const runStart = performance.now();

  const config = options.configPath
    ? await loadConfigFromPath(options.configPath)
    : await loadConfig(process.cwd());

  debugLog(options.debug, "Using config:", config);

  const testDir = resolve(
    process.cwd(),
    config?.testDir ?? options.testDir ?? "test",
  );

  let files = discoverTestFiles(testDir);

  if (options.pattern) {
    files = files.filter((f) => options.pattern!.test(normalizePath(f)));
  }

  files = filterByIncludesExcludes(
    files,
    config?.includes,
    config?.excludes,
  ).sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));

  debugLog(options.debug, "Discovered test files:", files);

  if (options.list) {
    if (options.json) {
      console.log(JSON.stringify({ files, count: files.length }, null, 2));
    } else {
      for (const file of files) console.log(file);

      if (options.debug) console.log(`\n${files.length} file(s)`);
    }
    return;
  }

  const timeoutMs = options.timeoutMs ?? config?.timeoutMs;
  const bail = options.bail ?? config?.bail ?? false;

  const engine = await runEngine({
    files,
    timeoutMs,
    bail,
    matchers: config?.matchers,
  });

  debugLog(options.debug, "Only mode:", engine.isOnly);

  const results = engine.results;

  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const failures: typeof results = [];
  const serializedResults: JsonReport["results"] = [];

  for (const result of results) {
    total++;

    if (result.status === TaskStatus.Pass) passed++;
    else if (result.status === TaskStatus.Skipped) skipped++;
    else if (result.status === TaskStatus.Fail) failed++;

    if (result.status === TaskStatus.Fail) failures.push(result);

    serializedResults.push({
      description: result.description,
      status: result.status,
      durationMs: result.durationMs ?? 0,
      error: result.error
        ? { message: result.error.message, stack: result.error.stack }
        : undefined,
    });
  }

  const ok = failed === 0;
  const durationMs = performance.now() - runStart;

  if (options.json) {
    const report: JsonReport = {
      ok,
      failed,
      passed,
      skipped,
      total,
      bail,
      timeoutMs,
      testDir: normalizePath(testDir),
      configPath: options.configPath ?? null,
      files: files.map(normalizePath),
      durationMs,
      results: serializedResults,
    };

    console.log(JSON.stringify(report, null, 2));

    if (!ok) process.exitCode = 1;

    return;
  }

  // Reporting
  const durationColWidth = 8;
  let lastHeading: string | null = null;

  for (const result of results) {
    const heading = getFileHeadingFromDescription(result.description);

    if (heading && heading !== lastHeading) {
      console.log(chalk.bold(`\n${heading}`));
      lastHeading = heading;
    }

    const duration = formatDuration(result.durationMs ?? 0);
    const durationPadded = padRight(duration, durationColWidth);

    if (result.status === TaskStatus.Pass) {
      console.log(
        chalk.green("✔"),
        durationPadded,
        result.description.replace(/^.*?›\s*/, ""),
      );

      continue;
    }

    if (result.status === TaskStatus.Skipped) {
      console.log(
        chalk.yellow("↷"),
        padRight("—", durationColWidth),
        result.description.replace(/^.*?›\s*/, ""),
      );

      continue;
    }

    // Fail
    console.log(
      chalk.red("✘"),
      durationPadded,
      result.description.replace(/^.*?›\s*/, ""),
    );
  }

  // Failures section (numbered, readable)
  if (failures.length > 0) {
    console.log(chalk.bold("\nFailures:"));

    failures.forEach((r, i) => {
      console.log(chalk.red(`\n${i + 1}) ${r.description}`));

      if (r.error) {
        console.log(chalk.red(r.error.stack ?? r.error.message));
      }
    });
  }

  // Summary
  console.log(
    chalk.bold(
      `\nPassed: ${passed}  Failed: ${failed}  Skipped: ${skipped}  Total: ${total}  Time: ${formatDuration(
        durationMs,
      )}\n`,
    ),
  );

  if (!ok) process.exitCode = 1;
}

export { runTestsCLI };
