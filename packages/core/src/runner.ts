import { relative, resolve } from "node:path";

import {
  loadConfig,
  loadConfigFromPath,
  type LoadedConfig,
} from "./utils/loadConfig";

import { cleanUnriftCaches } from "./utils/transform";
import { colors } from "./utils/colors";
import { discoverTestFiles } from "./utils/discoverTestFiles";
import { runEngine } from "./run";

import { normalizePath } from "./utils/normalizePath";
import { TaskStatus } from "./types";

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
  todo: number;
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

const regExpCache = new Map<string, RegExp>();

function getCachedRegExp(pattern: string): RegExp {
  let re = regExpCache.get(pattern);

  if (!re) {
    re = safeRegExp(pattern);
    regExpCache.set(pattern, re);
  }

  return re;
}

/**
 * @TODO Add glob support
 */
function matchesAnyPattern(
  fileAbs: string,
  patterns: string[],
  baseDir: string,
): boolean {
  const absolutePath = normalizePath(fileAbs);
  const relativePath = normalizePath(relative(baseDir, fileAbs));

  return patterns.some((pattern) => {
    const re = getCachedRegExp(pattern);

    return re.test(relativePath) || re.test(absolutePath);
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

function getFileHeadingFromDescription(description: string): string | null {
  const index = description.indexOf("›");

  if (index === -1) return null;

  return description.slice(0, index).trim();
}

function shortenPath(absPath: string): string {
  const cwd = normalizePath(process.cwd());
  const norm = normalizePath(absPath);

  if (norm.startsWith(cwd + "/")) return norm.slice(cwd.length + 1);

  return norm;
}

function horizontalRule(label?: string): string {
  const width = Math.min(process.stdout.columns || 80, 80);

  if (!label) return colors.dim("─".repeat(width));

  const padding = 2;
  const labelLen = label.length + padding * 2;
  const sideLen = Math.max(1, Math.floor((width - labelLen) / 2));
  const left = "─".repeat(sideLen);
  const right = "─".repeat(Math.max(1, width - sideLen - labelLen));

  return (
    colors.dim(`${left}${"─".repeat(padding)}`) +
    label +
    colors.dim(`${"─".repeat(padding)}${right}`)
  );
}

type FileGroup = {
  heading: string;
  results: Array<{
    description: string;
    status: TaskStatus;
    durationMs: number;
    error?: Error;
  }>;
};

function groupResultsByFile(
  results: Array<{
    description: string;
    status: TaskStatus;
    error?: Error;
    durationMs: number;
  }>,
): FileGroup[] {
  const groups: FileGroup[] = [];
  let current: FileGroup | null = null;

  for (const result of results) {
    const heading = getFileHeadingFromDescription(result.description);
    const key = heading ?? "";

    if (!current || current.heading !== key) {
      current = { heading: key, results: [] };
      groups.push(current);
    }

    current.results.push(result);
  }

  return groups;
}

function getFileStats(group: FileGroup) {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  let todoCount = 0;
  let totalDuration = 0;

  for (const r of group.results) {
    if (r.status === TaskStatus.Pass) pass++;
    else if (r.status === TaskStatus.Fail) fail++;
    else if (r.status === TaskStatus.Skipped) skip++;
    else if (r.status === TaskStatus.Todo) todoCount++;
    totalDuration += r.durationMs;
  }

  return {
    pass,
    fail,
    skip,
    todo: todoCount,
    total: group.results.length,
    totalDuration,
  };
}

function extractTestName(description: string): string {
  // Remove the file heading and first suite separator, keep nested describe structure
  return description.replace(/^.*?›\s*/, "");
}

export async function runTestsCLI(options: RunnerOptions = {}) {
  regExpCache.clear();
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

  // Load config and capture its directory so testDir can be relative to it
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

  // Test dir is relative to config dir if config is loaded
  const testDir = resolve(
    configDir,
    config?.testDir ?? options.testDir ?? "test",
  );

  let files = discoverTestFiles(testDir);

  const pattern =
    options.pattern ??
    (config?.pattern ? safeRegExp(config.pattern) : undefined);

  if (pattern) {
    files = files.filter((f) => pattern.test(normalizePath(f)));
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

  // No test files found
  if (files.length === 0) {
    const dir = normalizePath(testDir);

    if (options.json) {
      const report: JsonReport = {
        ok: false,
        failed: 0,
        passed: 0,
        skipped: 0,
        todo: 0,
        total: 0,
        bail: options.bail ?? config?.bail ?? false,
        timeoutMs: options.timeoutMs ?? config?.timeoutMs,
        testDir: dir,
        configPath: resolvedConfigPath,
        files: [],
        durationMs: performance.now() - runStart,
        results: [],
      };

      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `\n ${colors.boldYellow("!")} No test files found in ${colors.bold(dir)}\n`,
      );
    }

    process.exitCode = 1;

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
  let todo = 0;

  const failures: typeof results = [];
  const serializedResults: JsonReport["results"] = [];

  for (const result of results) {
    total++;

    if (result.status === TaskStatus.Pass) passed++;
    else if (result.status === TaskStatus.Skipped) skipped++;
    else if (result.status === TaskStatus.Fail) failed++;
    else if (result.status === TaskStatus.Todo) todo++;

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

  // JSON mode: stdout must be JSON only
  if (options.json) {
    const report: JsonReport = {
      ok,
      failed,
      passed,
      skipped,
      todo,
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

  // ── Pretty reporting ──────────────────────────────────────────────

  const groups = groupResultsByFile(results);

  // File-by-file results
  for (const group of groups) {
    const stats = getFileStats(group);
    const shortPath = shortenPath(group.heading);

    // File heading with inline summary
    const fileIcon =
      stats.fail > 0 ? colors.boldRed("✘") : colors.boldGreen("✓");
    const countParts: string[] = [];

    if (stats.pass > 0) countParts.push(colors.green(`${stats.pass} passed`));
    if (stats.fail > 0) countParts.push(colors.red(`${stats.fail} failed`));
    if (stats.skip > 0) countParts.push(colors.yellow(`${stats.skip} skipped`));
    if (stats.todo > 0) countParts.push(colors.magenta(`${stats.todo} todo`));

    const fileDuration = colors.dim(formatDuration(stats.totalDuration));
    const countSummary =
      colors.dim("(") + countParts.join(colors.dim(", ")) + colors.dim(")");

    console.log(
      `\n ${fileIcon} ${colors.bold(shortPath)} ${countSummary} ${fileDuration}`,
    );

    // Individual test results, indented
    let lastSuitePath = "";

    for (const result of group.results) {
      const testName = extractTestName(result.description);
      const parts = testName.split(" › ");
      const leaf = parts[parts.length - 1];
      const suitePath = parts.slice(0, -1).join(" › ");
      const depth = parts.length - 1;

      // Print suite name when it changes (depth > 0 guards against top-level it() tests)
      if (depth > 0 && suitePath && suitePath !== lastSuitePath) {
        const suiteIndent = "   " + "  ".repeat(Math.max(0, depth - 1));

        console.log(
          `${suiteIndent}${colors.dim("›")} ${colors.bold(parts[depth - 1])}`,
        );
        lastSuitePath = suitePath;
      }
      const indent = "   " + "  ".repeat(depth);

      if (result.status === TaskStatus.Pass) {
        const dur = colors.dim(formatDuration(result.durationMs ?? 0));

        console.log(
          `${indent}${colors.green("✔")} ${colors.dim(leaf)} ${dur}`,
        );
        continue;
      }

      if (result.status === TaskStatus.Fail) {
        const dur = colors.dim(formatDuration(result.durationMs ?? 0));

        console.log(
          `${indent}${colors.red("✘")} ${colors.boldRed(leaf)} ${dur}`,
        );
        continue;
      }

      if (result.status === TaskStatus.Skipped) {
        console.log(`${indent}${colors.yellow("↷")} ${colors.dim(leaf)}`);
        continue;
      }

      if (result.status === TaskStatus.Todo) {
        console.log(`${indent}${colors.magenta("○")} ${colors.dim(leaf)}`);
        continue;
      }
    }
  }

  // ── Failure details ────────────────────────────────────────────────
  if (failures.length > 0) {
    console.log(`\n${horizontalRule(colors.boldRed(" FAILURES "))}\n`);

    failures.forEach((r, i) => {
      const testName = extractTestName(r.description);

      console.log(colors.boldRed(`  ${i + 1}) ${testName}`));

      if (r.error) {
        const errText = r.error.stack ?? r.error.message;
        const lines = errText.split("\n");

        for (const line of lines) {
          // Highlight the "Received/Expected" lines differently
          if (line.trimStart().startsWith("Received:")) {
            console.log(colors.red(`     ${line.trim()}`));
          } else if (line.trimStart().startsWith("Expected:")) {
            console.log(colors.green(`     ${line.trim()}`));
          } else if (line.trim().startsWith("at ")) {
            console.log(colors.dim(`     ${line.trim()}`));
          } else {
            console.log(`     ${colors.red(line.trim())}`);
          }
        }
      }

      if (i < failures.length - 1) console.log("");
    });

    console.log(`\n${horizontalRule()}`);
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log("");

  const summaryParts: string[] = [];

  if (passed > 0) summaryParts.push(colors.boldGreen(`${passed} passed`));
  if (failed > 0) summaryParts.push(colors.boldRed(`${failed} failed`));
  if (skipped > 0) summaryParts.push(colors.boldYellow(`${skipped} skipped`));
  if (todo > 0) summaryParts.push(colors.magenta(`${todo} todo`));

  const badge = ok ? colors.badgePass(" PASS ") : colors.badgeFail(" FAIL ");

  console.log(
    ` ${badge}  ${summaryParts.join(colors.dim("  ·  "))}  ${colors.dim("of")} ${colors.bold(String(total))} ${colors.dim("tests")}  ${colors.dim("in")} ${colors.bold(formatDuration(durationMs))}`,
  );

  console.log(
    `         ${colors.dim(`${files.length} test file${files.length === 1 ? "" : "s"}`)}${bail ? colors.dim("  ·  bail mode") : ""}`,
  );

  console.log("");

  if (!ok) process.exitCode = 1;
}
