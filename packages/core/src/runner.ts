import { relative, resolve } from "path";

import {
  loadConfig,
  loadConfigFromPath,
  type LoadedConfig,
} from "./utils/loadConfig";
import { TaskStatus } from "./types";

import { discoverTestFiles } from "./utils/discoverTestFiles";
import { runEngine } from "./run";
import { colors } from "./utils/colors";
import { cleanUnriftCaches } from "./utils/transform";

interface RunnerOptions {
  configPath?: string;
  testDir?: string;
  pattern?: RegExp;
  timeoutMs?: number;
  bail?: boolean;
  debug?: boolean;
  list?: boolean;
  json?: boolean;
  cacheClean?: boolean;
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

function normalizePath(p: string): string {
  // stable for matching/reporting across platforms
  return p.replace(/\\/g, "/");
}

function debugLog(
  enabled: boolean | undefined,
  json: boolean | undefined,
  ...args: unknown[]
) {
  // Keep stdout clean for --json mode; use stderr for debug.
  if (!enabled) return;
  (json ? console.error : console.log)(...args);
}

function safeRegExp(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex "${source}": ${msg}`);
  }
}

/**
 * Match include/exclude patterns against:
 *  1) path relative to testDir (what users usually expect)
 *  2) absolute path as a fallback
 *
 * Patterns remain regex strings (back-compat). If you later add glob support,
 * this is the choke point to swap in a different matcher.
 */
function matchesAnyPattern(
  fileAbs: string,
  patterns: string[],
  baseDir: string,
): boolean {
  const abs = normalizePath(fileAbs);
  const rel = normalizePath(relative(baseDir, fileAbs));

  return patterns.some((pattern) => {
    const re = safeRegExp(pattern);
    return re.test(rel) || re.test(abs);
  });
}

function filterByIncludesExcludes(
  files: string[],
  baseDir: string,
  includes?: string[],
  excludes?: string[],
): string[] {
  let filtered = files;

  if (includes && includes.length > 0) {
    filtered = filtered.filter((file) =>
      matchesAnyPattern(file, includes, baseDir),
    );
  }

  if (excludes && excludes.length > 0) {
    filtered = filtered.filter(
      (file) => !matchesAnyPattern(file, excludes, baseDir),
    );
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

  // Cache clean mode
  if (options.cacheClean) {
    const projectRoot = process.cwd();
    const result = cleanUnriftCaches(projectRoot);

    if (options.json) {
      console.log(JSON.stringify({ ok: true, cleaned: result }, null, 2));
    } else {
      const lines: string[] = [];
      if (result.projectCacheDeleted) lines.push("✔ deleted project cache");
      if (result.tempCacheDeleted) lines.push("✔ deleted temp cache");
      if (lines.length === 0) lines.push("— nothing to clean");
      console.log(lines.join("\n"));
    }

    return;
  }

  // Load config (and capture its directory so testDir can be relative to it)
  const loaded: LoadedConfig | null = options.configPath
    ? await loadConfigFromPath(options.configPath)
    : await loadConfig(process.cwd());

  const config = loaded?.config ?? null;
  const configDir = loaded?.configDir ?? process.cwd();
  const resolvedConfigPath = loaded?.configPath ?? null;

  debugLog(options.debug, options.json, "Using config:", {
    configPath: resolvedConfigPath,
    configDir,
    config,
  });

  // IMPORTANT: testDir is now relative to the config file directory (if present)
  const testDir = resolve(
    configDir,
    config?.testDir ?? options.testDir ?? "test",
  );

  let files = discoverTestFiles(testDir);

  if (options.pattern) {
    files = files.filter((f) => options.pattern!.test(normalizePath(f)));
  }

  files = filterByIncludesExcludes(
    files,
    testDir,
    config?.includes,
    config?.excludes,
  ).sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));

  debugLog(options.debug, options.json, "Discovered test files:", files);

  // List mode
  if (options.list) {
    if (options.json) {
      console.log(
        JSON.stringify(
          { files: files.map(normalizePath), count: files.length },
          null,
          2,
        ),
      );
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

  debugLog(options.debug, options.json, "Only mode:", engine.isOnly);

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

  // JSON mode: stdout must be JSON only (critical for fixture/subprocess tests)
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
      configPath: resolvedConfigPath,
      files: files.map(normalizePath),
      durationMs,
      results: serializedResults,
    };

    console.log(JSON.stringify(report, null, 2));

    if (!ok) process.exitCode = 1;
    return;
  }

  // Human reporting
  const durationColWidth = 8;
  let lastHeading: string | null = null;

  for (const result of results) {
    const heading = getFileHeadingFromDescription(result.description);

    if (heading && heading !== lastHeading) {
      console.log(colors.bold(`\n${heading}`));
      lastHeading = heading;
    }

    const duration = formatDuration(result.durationMs ?? 0);
    const durationPadded = padRight(duration, durationColWidth);

    if (result.status === TaskStatus.Pass) {
      console.log(
        colors.green("✔"),
        durationPadded,
        result.description.replace(/^.*?›\s*/, ""),
      );
      continue;
    }

    if (result.status === TaskStatus.Skipped) {
      console.log(
        colors.yellow("↷"),
        padRight("—", durationColWidth),
        result.description.replace(/^.*?›\s*/, ""),
      );
      continue;
    }

    // Fail
    console.log(
      colors.red("✘"),
      durationPadded,
      result.description.replace(/^.*?›\s*/, ""),
    );
  }

  if (failures.length > 0) {
    console.log(colors.bold("\nFailures:"));

    failures.forEach((r, i) => {
      console.log(colors.red(`\n${i + 1}) ${r.description}`));
      if (r.error) console.log(colors.red(r.error.stack ?? r.error.message));
    });
  }

  console.log(
    colors.bold(
      `\nPassed: ${passed}  Failed: ${failed}  Skipped: ${skipped}  Total: ${total}  Time: ${formatDuration(
        durationMs,
      )}\n`,
    ),
  );

  if (!ok) process.exitCode = 1;
}

export { runTestsCLI };
