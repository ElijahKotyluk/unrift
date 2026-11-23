import {
  watch as nodeWatch,
  existsSync,
  readdirSync,
  statSync,
  type FSWatcher,
} from "node:fs";
import { fileURLToPath } from "node:url";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  join,
  sep,
} from "node:path";

import {
  loadConfig,
  loadConfigFromPath,
  type LoadedConfig,
} from "./utils/loadConfig";

import {
  bundledFiles,
  cleanUnriftCaches,
  isSubpath,
  startBundleRun,
} from "./utils/transform";
import { colors } from "./utils/colors";
import { discoverTestFiles } from "./utils/discoverTestFiles";
import { runEngine } from "./run";
import type { TestResult } from "./suite";
import type { SnapshotSummary } from "./snapshot/state";
import {
  assertValidCoverageConfig,
  checkThresholds,
  formatCoverageTable,
  writeCoverageReports,
  type CoverageReporter,
  type CoverageSummary,
} from "./coverage/report";

import { normalizePath } from "./utils/normalizePath";
import { isOwnWrite } from "./utils/ownWrites";
import { resolveImport } from "./utils/moduleMockPlugin";
import { safeRegExp, isGlobPattern, globToRegex } from "./utils/helpers";
import { TaskStatus } from "./types";

/**
 * Captured at module load so the runner's own timing measurements
 * aren't affected by user mocks (e.g. mock.useFakeTimers patches performance.now).
 */
const realPerformanceNow = performance.now.bind(performance);

interface RunnerOptions {
  configPath?: string;
  testDir?: string;
  pattern?: RegExp;
  grep?: RegExp;
  timeoutMs?: number;
  workers?: number;
  bail?: boolean;
  debug?: boolean;
  list?: boolean;
  json?: boolean;
  cacheClean?: boolean;
  updateSnapshots?: boolean;
  coverage?: boolean;
  coverageReporters?: string[];
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
  snapshots?: SnapshotSummary;
  coverage?: CoverageSummary & { failures: string[]; reports: string[] };
  results: Array<{
    description: string;
    status: TaskStatus;
    durationMs: number;
    attempts?: number;
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

const regExpCache = new Map<string, RegExp>();

function getCachedRegExp(pattern: string): RegExp {
  let re = regExpCache.get(pattern);

  if (!re) {
    re = isGlobPattern(pattern) ? globToRegex(pattern) : safeRegExp(pattern);
    regExpCache.set(pattern, re);
  }

  return re;
}

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

function filterStack(stack: string): string {
  const lines = stack.split("\n");
  const message: string[] = [];
  const frames: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith("at ")) {
      frames.push(line);
    } else {
      message.push(line);
    }
  }

  const filtered = frames.filter((line) => {
    if (line.includes("node:")) return false;
    if (line.includes("/@unrift/core/dist/")) return false;
    if (line.includes("/unrift/dist/")) return false;
    if (line.includes("/dist/esm/")) return false;

    return true;
  });

  const kept = filtered.length > 0 ? filtered : frames;

  return [...message, ...kept].join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;

  return `${(ms / 1000).toFixed(2)}s`;
}

function getFileHeadingFromDescription(description: string): string | null {
  const index = description.indexOf("›");

  if (index !== -1) return description.slice(0, index).trim();

  // A file's own result, like "a.spec.ts > [import]". The run's own ones
  // ("root > [worker]") have no file.
  const own = /^(.*) > \[[^\]]+\]$/.exec(description);

  return own && own[1] !== "root" ? own[1] : null;
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
  results: TestResult[];
};

function groupResultsByFile(results: TestResult[]): FileGroup[] {
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
  // A file's own result is its label, under the file's heading
  if (
    getFileHeadingFromDescription(description) !== null &&
    !description.includes("›")
  ) {
    return description.replace(/^.* > (\[[^\]]+\])$/, "$1");
  }

  // Remove the file heading and first suite separator, keep nested describe structure
  return description.replace(/^.*?›\s*/, "");
}

const MAX_OBSOLETE_SHOWN = 20;

/** Grouped by .snap file, so a rename is easy to tell from a snapshot that only runs sometimes. */
function formatObsolete(keys: SnapshotSummary["obsoleteKeys"]): string {
  const lines: string[] = [];
  let lastFile = "";

  for (const { file, key } of keys.slice(0, MAX_OBSOLETE_SHOWN)) {
    if (file !== lastFile) {
      lines.push(`   ${colors.dim(shortenPath(file))}`);
      lastFile = file;
    }

    lines.push(`     ${colors.yellow("›")} ${key}`);
  }

  if (keys.length > MAX_OBSOLETE_SHOWN) {
    lines.push(colors.dim(`     and ${keys.length - MAX_OBSOLETE_SHOWN} more`));
  }

  return lines.join("\n");
}

function formatSnapshotSummary(s: SnapshotSummary): string {
  const parts: string[] = [];

  if (s.added > 0) parts.push(colors.green(`${s.added} written`));
  if (s.updated > 0) parts.push(colors.green(`${s.updated} updated`));
  if (s.removed > 0) parts.push(colors.green(`${s.removed} removed`));
  if (s.failed > 0) parts.push(colors.red(`${s.failed} failed`));
  if (s.obsolete > s.removed) {
    parts.push(colors.yellow(`${s.obsolete - s.removed} obsolete`));
  }

  if (parts.length === 0) return "";

  return `${colors.dim("snapshots:")} ${parts.join(colors.dim("  ·  "))}`;
}

export async function runTestsCLI(options: RunnerOptions = {}) {
  regExpCache.clear();
  const runStart = realPerformanceNow();

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
      if (lines.length === 0) lines.push("- nothing to clean");
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

  lastTestFiles = new Set(files.map((f) => resolve(f)));

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
        durationMs: realPerformanceNow() - runStart,
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

  const coverageConfig = config?.coverage;
  const coverageOn = options.coverage ?? coverageConfig?.enabled ?? false;
  let reporters: CoverageReporter[] = [];

  if (coverageOn) {
    const named: unknown =
      options.coverageReporters ??
      (coverageConfig?.reporter === undefined
        ? ["text"]
        : [coverageConfig.reporter].flat());

    assertValidCoverageConfig(named, coverageConfig?.thresholds);
    reporters = named;
  }

  const engine = await runEngine({
    files,
    timeoutMs,
    bail,
    grep: options.grep,
    retries: config?.retries,
    // From the config's folder, like testDir. A package too: from unrift's
    // own folder it wouldn't be found when unrift is linked.
    matchers:
      config?.matchers &&
      (await Promise.all(
        config.matchers.map(async (spec) =>
          typeof spec !== "string" || isAbsolute(spec)
            ? spec
            : spec.startsWith("file:")
              ? fileURLToPath(spec)
              : spec.startsWith(".")
                ? resolve(configDir, spec)
                : await resolveMatcherPackage(spec, configDir),
        ),
      )),
    workers: options.workers ?? config?.workers,
    updateSnapshots: options.updateSnapshots ? "all" : undefined,
    coverage: coverageOn
      ? {
          root: configDir,
          include: coverageConfig?.include,
          exclude: coverageConfig?.exclude,
        }
      : undefined,
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
      attempts:
        result.attempts && result.attempts > 1 ? result.attempts : undefined,
      error: result.error
        ? { message: result.error.message, stack: result.error.stack }
        : undefined,
    });
  }

  const snapshots = engine.snapshots;
  const coverage = engine.coverage;
  const coverageReports = coverage
    ? writeCoverageReports(
        coverage.files,
        coverage.summary,
        reporters,
        resolve(configDir, coverageConfig?.reportsDirectory ?? "coverage"),
      )
    : [];
  const coverageFailures = coverage
    ? checkThresholds(coverage.summary.total, coverageConfig?.thresholds)
    : [];

  // Obsolete snapshots fail the run until they're removed with -u, and so
  // does a snapshot that couldn't be read or written
  const obsoleteLeft = snapshots.obsolete - snapshots.removed;
  const ok =
    failed === 0 &&
    obsoleteLeft === 0 &&
    snapshots.errors.length === 0 &&
    coverageFailures.length === 0;
  const durationMs = realPerformanceNow() - runStart;

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
      snapshots: {
        ...snapshots,
        filesWritten: snapshots.filesWritten.map(normalizePath),
        obsoleteKeys: snapshots.obsoleteKeys.map(({ file, key }) => ({
          file: normalizePath(file),
          key,
        })),
        inlineSkipped: snapshots.inlineSkipped.map(normalizePath),
        errors: snapshots.errors.map(({ file, message }) => ({
          file: normalizePath(file),
          message,
        })),
      },
      coverage: coverage && {
        total: coverage.summary.total,
        files: coverage.summary.files.map((f) => ({
          ...f,
          file: normalizePath(f.file),
        })),
        failures: coverageFailures,
        reports: coverageReports.map(normalizePath),
      },
      results: serializedResults,
    };

    console.log(JSON.stringify(report, null, 2));

    // From the results only, a test that set it doesn't decide
    process.exitCode = ok ? 0 : 1;

    return;
  }

  // Pretty reporting

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
      const retried =
        result.attempts && result.attempts > 1
          ? colors.yellow(
              ` (${result.status === TaskStatus.Fail ? "failed" : "passed"} after ${result.attempts} attempts)`,
            )
          : "";

      if (result.status === TaskStatus.Pass) {
        const dur = colors.dim(formatDuration(result.durationMs ?? 0));

        console.log(
          `${indent}${colors.green("✔")} ${colors.dim(leaf)}${retried} ${dur}`,
        );
        continue;
      }

      if (result.status === TaskStatus.Fail) {
        const dur = colors.dim(formatDuration(result.durationMs ?? 0));

        console.log(
          `${indent}${colors.red("✘")} ${colors.boldRed(leaf)}${retried} ${dur}`,
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

  // Failure details
  if (failures.length > 0) {
    console.log(`\n${horizontalRule(colors.boldRed(" FAILURES "))}\n`);

    failures.forEach((r, i) => {
      const heading = getFileHeadingFromDescription(r.description);
      // With its file, two files can have a test of the same name
      const testName = heading
        ? `${shortenPath(heading)} › ${extractTestName(r.description)}`
        : extractTestName(r.description);

      console.log(colors.boldRed(`  ${i + 1}) ${testName}`));

      if (r.error) {
        const errText = filterStack(r.error.stack ?? r.error.message);
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
            // Keep leading spaces, diffs (snapshots especially) need them
            console.log(`     ${colors.red(line.trimEnd())}`);
          }
        }
      }

      if (i < failures.length - 1) console.log("");
    });

    console.log(`\n${horizontalRule()}`);
  }

  if (coverage && reporters.includes("text")) {
    console.log(`\n${horizontalRule(colors.bold(" COVERAGE "))}\n`);

    if (coverage.files.length === 0) {
      console.log(
        `  ${colors.dim("No files to report, the tests didn't load any")}`,
      );
    } else {
      const [header, ...rows] = formatCoverageTable(
        coverage.summary,
        configDir,
      );

      console.log(`  ${colors.dim(header)}`);
      rows.forEach((row, i) =>
        console.log(`  ${i === rows.length - 1 ? colors.bold(row) : row}`),
      );
    }

    console.log(`\n${horizontalRule()}`);
  }

  // Summary
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

  const snapshotLine = formatSnapshotSummary(snapshots);

  if (snapshotLine) console.log(`         ${snapshotLine}`);

  if (obsoleteLeft > 0) {
    console.log(
      `\n ${colors.boldYellow("!")} ${obsoleteLeft} obsolete snapshot${obsoleteLeft === 1 ? "" : "s"}, run with -u to remove ${obsoleteLeft === 1 ? "it" : "them"}`,
    );
    console.log(formatObsolete(snapshots.obsoleteKeys));
  }

  for (const { file, message } of snapshots.errors) {
    console.log(`\n ${colors.boldRed("✘")} ${shortenPath(file)}: ${message}`);
  }

  for (const failure of coverageFailures) {
    console.log(`\n ${colors.boldRed("✘")} ${failure}`);
  }

  for (const file of snapshots.inlineSkipped) {
    console.log(
      `\n ${colors.boldYellow("!")} ${shortenPath(file)} changed during the run, its inline snapshots weren't written`,
    );
  }

  console.log("");

  // From the results only, a test that set it doesn't decide
  process.exitCode = ok ? 0 : 1;
}

/**
 * Watch a directory tree for changes, calling `onChange` after a debounce.
 * Uses individual `fs.watch()` calls per directory so it works on all
 * platforms (Linux `fs.watch` does not support `recursive: true` before Node 22).
 * Returns a cleanup function to stop watching.
 */
async function resolveMatcherPackage(spec: string, dir: string) {
  const found = await resolveImport(spec, dir);

  if (found === null) {
    throw new Error(
      `Unrift: matchers package ${spec} can't be imported from ${dir}: it isn't installed there, or it has no export for import`,
    );
  }

  return found;
}

// The test files the last run found, for watch mode
let lastTestFiles = new Set<string>();

// Watch mode tells its own writes from the user's by what's in ownWrites.ts,
// stamped as they're written, by a worker too
function modifiedSince(path: string, time: number): boolean {
  try {
    return statSync(resolve(path)).mtimeMs >= time;
  } catch {
    return false;
  }
}

// When a watched folder was first seen to have each path, for a file a test
// makes and removes. Kept past the event, its delete can be reported late.
const appeared = new Map<string, number>();

/** Whether `path`, or a folder it's in, showed up at `time` or later. */
function appearedSince(path: string, time: number): boolean {
  for (let p = resolve(path); ; p = dirname(p)) {
    if ((appeared.get(p) ?? -1) >= time) return true;
    if (dirname(p) === p) return false;
  }
}

/** Drops what showed up before `time`, it's no longer asked about. */
function forgetAppearedBefore(time: number) {
  for (const [path, at] of appeared) if (at < time) appeared.delete(path);
}

function watchRecursive(
  dir: string,
  onChange: (filename: string, path: string) => void,
  debounceMs = 150,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Every path changed within the debounce, one may be a run's own write
  let changed = new Map<string, string>();
  // What each watched folder has, to tell a new file from one that was there
  const listing = new Map<string, Set<string>>();

  const list = (d: string) => {
    try {
      listing.set(d, new Set(readdirSync(d)));
    } catch {
      listing.delete(d);
    }
  };

  function trigger(filename: string, path: string) {
    changed.set(path, filename);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = changed;

      changed = new Map();
      for (const [path, filename] of paths) onChange(filename, path);
    }, debounceMs);
  }

  // A folder deleted and made again at the same path (like __snapshots__)
  // needs a new watcher, the old one stays on the deleted folder. Its watcher
  // is dropped when the delete is seen. Linux reuses inode numbers right away,
  // so the inode check is only a backup for a delete that wasn't seen.
  const watched = new Map<string, { watcher: FSWatcher; ino: number }>();

  function forget(path: string) {
    for (const [dir, { watcher }] of watched) {
      if (dir === path || dir.startsWith(path + sep)) {
        closeWatcher(watcher);
        watched.delete(dir);
      }
    }
  }

  // A folder made after startup (the first __snapshots__, a new test dir)
  // gets its own watcher, before its creation event is checked below
  function watchIfNewDir(path: string) {
    let ino: number;

    try {
      const st = statSync(path);

      if (!st.isDirectory()) return;
      ino = st.ino;
    } catch {
      forget(path);
      return;
    }

    const existing = watched.get(path);

    if (existing?.ino === ino) return;

    if (existing) {
      closeWatcher(existing.watcher);
      watched.delete(path);
    }

    const name = basename(path);

    if (!name.startsWith(".") && name !== "node_modules") watchDir(path);
  }

  function watchDir(d: string) {
    let ino: number;

    try {
      ino = statSync(d).ino;
    } catch {
      return;
    }

    try {
      const watcher = fsWatch(d, (_event, filename) => {
        const before = listing.get(d);

        list(d);

        // Not there before: made since, by a test say. Its name may be gone
        // already, the files made with it may not have had their event yet.
        if (before) {
          const names = new Set(listing.get(d));
          const now = Date.now();

          if (filename) names.add(filename);
          for (const name of names) {
            if (!before.has(name)) appeared.set(join(d, name), now);
          }
        }

        if (filename) watchIfNewDir(join(d, filename));

        // Our own snapshot writes shouldn't trigger another run, edits by
        // the user (fixing or deleting a .snap) should
        // (macOS also reports a change to the watched folder itself by its name)
        if (
          filename &&
          (isOwnWrite(join(d, filename)) ||
            (filename === basename(d) && isOwnWrite(d)))
        ) {
          return;
        }
        // macOS reports a change to the watched folder by its own name
        const path =
          !filename ||
          (filename === basename(d) && !existsSync(join(d, filename)))
            ? d
            : join(d, filename);

        trigger(filename ?? d, path);
      });

      // Deleting a watched folder can emit an error on some platforms
      watcher.on("error", () => {});
      watched.set(d, { watcher, ino });
      list(d);

      if (process.env.UNRIFT_DEBUG === "1")
        console.log(`[unrift] watching ${d}`);
    } catch {
      return;
    }

    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        watchDir(join(d, entry.name));
      }
    }
  }

  // A test dir that doesn't exist yet is watched from when it's made
  const stopWaiting = waitForDir(dir, () => {
    watchDir(dir);
    trigger(dir, dir);
  });

  watchDir(dir);

  return () => {
    stopWaiting();
    if (timer) clearTimeout(timer);
    for (const { watcher } of watched.values()) closeWatcher(watcher);
  };
}

/**
 * Calls `onCreated` once `dir` is made, by watching the closest folder above
 * it that exists. Does nothing if it's already there.
 */
function waitForDir(dir: string, onCreated: () => void): () => void {
  let watcher: FSWatcher | null = null;
  const close = () => {
    if (watcher) closeWatcher(watcher);
    watcher = null;
  };

  const check = () => {
    close();
    if (existsSync(dir)) return;

    let parent = dirname(dir);

    while (!existsSync(parent) && dirname(parent) !== parent) {
      parent = dirname(parent);
    }

    try {
      watcher = fsWatch(parent, () => {
        if (!existsSync(dir)) return check();
        close();
        onCreated();
      });
      watcher.on("error", () => {});
    } catch {
      // Nothing above it to watch
    }
  };

  check();

  return close;
}

/**
 * Watch single files, calling `onChange` after a debounce. Each file's folder
 * is watched, not the file: an editor that saves by renaming a new file over
 * the old one would leave a watcher on the file looking at nothing.
 */
function watchFiles(
  onChange: (filename: string, path: string) => void,
  debounceMs = 150,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let changed = new Set<string>();
  let files = new Set<string>();
  const watched = new Map<string, { watcher: FSWatcher; ino: number }>();
  // Folders that are gone, watched for when they're made again
  const waiting = new Map<string, () => void>();
  // Folders that saw a file deleted or renamed since the last set(). The
  // folder itself may be deleted and made again, and Linux gives the new one
  // the same inode number, so these always get a new watcher.
  const renamed = new Set<string>();

  function trigger(path: string) {
    changed.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = changed;

      changed = new Set();
      for (const path of paths) onChange(path, path);
    }, debounceMs);
  }

  function unwatch(d: string) {
    const entry = watched.get(d);

    if (entry) closeWatcher(entry.watcher);
    watched.delete(d);
    waiting.get(d)?.();
    waiting.delete(d);
  }

  function watchDir(d: string) {
    let ino: number;

    try {
      ino = statSync(d).ino;
    } catch {
      // Gone, rerun once it's back. Its files are probably back with it.
      waiting.set(
        d,
        waitForDir(d, () => {
          waiting.delete(d);
          watchDir(d);
          trigger(d);
        }),
      );
      return;
    }

    try {
      const watcher = fsWatch(d, (event, filename) => {
        if (event === "rename") renamed.add(d);
        if (!filename) return;

        const path = join(d, filename);

        if (files.has(path) && !isOwnWrite(path)) trigger(path);
      });

      watcher.on("error", () => {});
      watched.set(d, { watcher, ino });
    } catch {
      // Gone between the stat and the watch, the next set() tries again
    }
  }

  return {
    /** Replaces what's watched with these files. */
    set(paths: string[]) {
      files = new Set(paths.map((p) => resolve(p)));

      const dirs = new Set([...files].map((f) => dirname(f)));

      for (const d of [...watched.keys(), ...waiting.keys()]) {
        if (!dirs.has(d)) unwatch(d);
      }

      for (const d of dirs) {
        if (waiting.has(d)) continue;

        // Linux keeps a watcher on a deleted folder, not on one made again
        // at the same path
        const entry = watched.get(d);

        if (entry) {
          let ino: number | null = null;

          try {
            ino = statSync(d).ino;
          } catch {
            // Gone, watchDir waits for it
          }

          if (ino === entry.ino && !renamed.has(d)) continue;
          unwatch(d);
        }

        watchDir(d);
      }

      renamed.clear();
    },
    close() {
      if (timer) clearTimeout(timer);
      for (const d of [...watched.keys(), ...waiting.keys()]) unwatch(d);
    },
  };
}

// Every watcher, so a run can stop them from keeping the process alive:
// with nothing else left, Node says a file is stuck (settles in run.ts)
const watchers = new Set<FSWatcher>();
let holding = true;

function fsWatch(
  path: string,
  listener: (event: string, filename: string | null) => void,
): FSWatcher {
  const watcher = nodeWatch(path, listener);

  watchers.add(watcher);
  if (!holding) watcher.unref();

  return watcher;
}

function holdOpen(on: boolean) {
  holding = on;

  for (const watcher of watchers) {
    if (on) watcher.ref();
    else watcher.unref();
  }
}

function closeWatcher(watcher: FSWatcher) {
  watchers.delete(watcher);

  try {
    watcher.close();
  } catch {
    // ignore
  }
}

async function resolveDirs(options: RunnerOptions) {
  // Same logic as runTestsCLI
  const loaded = options.configPath
    ? await loadConfigFromPath(options.configPath)
    : await loadConfig(process.cwd());
  const configDir = loaded?.configDir ?? process.cwd();

  return {
    configDir,
    configPath: loaded?.configPath ?? null,
    testDir: resolve(
      configDir,
      loaded?.config.testDir ?? options.testDir ?? "test",
    ),
  };
}

function logWatching(testDir: string) {
  console.log(
    `\n ${colors.dim("↺")} ${colors.dim("Watching")} ${colors.bold(shortenPath(testDir))} ${colors.dim("for changes…  Ctrl+C to quit")}\n`,
  );
}

export async function watchTestsCLI(options: RunnerOptions = {}) {
  // Run once immediately
  startBundleRun();
  await runTestsCLI(options);

  let { testDir, configDir, configPath } = await resolveDirs(options);

  let running = false;
  // Set while a run starts: the rest of the changes that started it, the
  // run already sees them
  let starting = false;
  // What was there from before watching isn't new
  let runStart = Date.now();
  // Paths changed during a run. A worker writes its snapshots mid-run, which
  // ones the run wrote itself is only known once it's done.
  const changedDuring = new Map<string, { filename: string; early: boolean }>();

  // Source files and the config live outside the test dir. Watch the ones
  // the last run bundled, the test dir is already watched as a whole.
  const imports = watchFiles((filename, path) => rerun(filename, path));
  // A build that failed doesn't say what it imports, so until it builds
  // anything under the config's folder reruns
  let stopFallback: (() => void) | null = null;

  const watchImports = () => {
    const { files, failed } = bundledFiles();

    // The config is watched even when it didn't load (deleted, say), so
    // putting it back reruns
    if (configPath) files.push(configPath);

    imports.set(
      files.filter(
        (f) => !isSubpath(f, testDir) && !f.split(sep).includes("node_modules"),
      ),
    );

    if (failed && !stopFallback) {
      stopFallback = watchRecursive(configDir, rerun);
    } else if (!failed && stopFallback) {
      stopFallback();
      stopFallback = null;
    }
  };

  // What the last run used, and the config. One of them gone, or a folder
  // with one in it, is always a change. Snapshots deleted by hand are too.
  const usedFiles = () => [
    ...lastTestFiles,
    ...bundledFiles().files.map((f) => resolve(f)),
    ...(configPath ? [resolve(configPath)] : []),
  ];
  const wasUsed = (path: string, used: string[]) => {
    const full = resolve(path);

    return (
      full.endsWith(".snap") ||
      basename(full) === "__snapshots__" ||
      used.some((f) => f === full || f.startsWith(full + sep))
    );
  };
  // New at its first change and gone now: made and removed, like a test's
  // temp file. One that was there before is a delete.
  const madeAndRemoved = (path: string, used: string[]) =>
    !existsSync(path) && appearedSince(path, runStart) && !wasUsed(path, used);

  const rerun = async (filename: string, path = filename) => {
    if (running) {
      changedDuring.set(path, {
        filename,
        early: starting && (changedDuring.get(path)?.early ?? true),
      });
      return;
    }

    // Seen during the last run, written by it, or a file a test made and
    // removed
    if (isOwnWrite(path) || madeAndRemoved(path, usedFiles())) return;

    running = true;
    runStart = Date.now();
    forgetAppearedBefore(runStart);
    starting = true;
    queueMicrotask(() => (starting = false));
    // What the last run used, before this one changes it
    const used = usedFiles();
    holdOpen(false);

    const shortFile = shortenPath(filename);
    console.log(
      `\n${colors.dim("─".repeat(Math.min(process.stdout.columns || 80, 80)))}`,
    );
    console.log(
      ` ${colors.dim("↺")} ${colors.dim(`${shortFile} changed - re-running…`)}\n`,
    );

    // Reset exit code so each run is evaluated independently
    process.exitCode = 0;

    let moved = false;

    try {
      startBundleRun();
      // -u is for the first run only. On every save it would overwrite a
      // mismatch saved mid-edit, or drop snapshots of a test being renamed.
      await runTestsCLI({ ...options, updateSnapshots: false });

      // An edit to the config (or a file it imports) can move the test dir
      const next = await resolveDirs(options);

      configDir = next.configDir;
      configPath = next.configPath;

      if (next.testDir !== testDir) {
        stop();
        testDir = next.testDir;
        stop = watchRecursive(testDir, rerun);
        moved = true;
      }
    } catch (err) {
      // A config that doesn't load, keep watching so the next save can fix it
      console.error(err);
      process.exitCode = 1;
    } finally {
      watchImports();
      holdOpen(true);
      running = false;
    }

    // One save can be reported again after the debounce. Only a file
    // written since the run started, and not by it, is a new change. A move
    // keeps its time: one that showed up during the run is a change, one
    // that's gone a delete, unless it showed up during the run too. What
    // came in with the change that started the run, the run already saw.
    const next = [...changedDuring].find(([path, { early }]) => {
      if (isOwnWrite(path)) return false;
      if (modifiedSince(path, runStart)) return true;
      if (early) return false;

      return existsSync(path)
        ? appearedSince(path, runStart)
        : !madeAndRemoved(path, used);
    });

    changedDuring.clear();

    if (next) void rerun(next[1].filename, next[0]);
    else if (moved) logWatching(testDir);
    else {
      console.log(
        ` ${colors.dim("↺")} ${colors.dim("Watching for changes…  Ctrl+C to quit")}\n`,
      );
    }
  };

  let stop = watchRecursive(testDir, rerun);

  watchImports();

  // Once it is: a pipe to stdout is written synchronously on Linux, a test
  // or script reading it could save a file before the watchers are set up
  logWatching(testDir);

  // Keep process alive and clean up on exit
  process.on("SIGINT", () => {
    stop();
    stopFallback?.();
    imports.close();
    process.exit(0);
  });
}
