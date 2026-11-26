import { AsyncLocalStorage } from "node:async_hooks";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { diffLines, formatSnapshotFile, readSnapshotFile } from "./file.js";
import {
  commitInlineEdits,
  matchInlineSnapshot,
  resetInlineSnapshots,
  takeInlineEdits,
  writeInlineSnapshots,
  type InlineSource,
  type InlineEdits,
} from "./inline.js";
import { serialize } from "./serialize.js";
import { noteWrite } from "../utils/ownWrites.js";

/**
 * - "all": write new snapshots and overwrite mismatches (`-u`)
 * - "new": write new snapshots, fail on mismatches (default)
 * - "none": write nothing, a missing snapshot fails (default on CI)
 */
export type SnapshotUpdateMode = "all" | "new" | "none";

export interface SnapshotSummary {
  /** New snapshots written. */
  added: number;
  /** Mismatches overwritten by `-u`. */
  updated: number;
  /** Snapshots that didn't match (or weren't written on CI). */
  failed: number;
  /** Stored snapshots no test used. Removed with `-u`, otherwise they fail the run. */
  obsolete: number;
  removed: number;
  /** The obsolete snapshots still in their file, so you can tell which ones before -u. */
  obsoleteKeys: Array<{ file: string; key: string }>;
  /** Snapshot files that were written or deleted, and test files with inline snapshots written. */
  filesWritten: string[];
  /** Test files that changed during the run, so their inline snapshots weren't written. */
  inlineSkipped: string[];
  /** Snapshot and test files that couldn't be read or written. Any of these fail the run. */
  errors: Array<{ file: string; message: string }>;
}

class SnapshotFile {
  readonly path: string;
  readonly saved: Map<string, string>;
  readonly data: Map<string, string>;
  /** Committed per-name counts, so two tests with the same name get `name 1` and `name 2`. */
  readonly counters = new Map<string, number>();
  readonly checked = new Set<string>();
  readonly failed = new Set<string>();
  readonly loadError?: Error;

  constructor(testFile: string) {
    this.path = join(
      dirname(testFile),
      "__snapshots__",
      `${basename(testFile)}.snap`,
    );

    let saved = new Map<string, string>();

    try {
      if (existsSync(this.path)) saved = readSnapshotFile(this.path);
    } catch (err) {
      this.loadError = err instanceof Error ? err : new Error(String(err));
    }

    this.saved = saved;
    this.data = new Map(saved);
  }
}

interface Scope {
  file: string;
  testName: string;
  counters: Map<string, number>;
  /** Held until the test is done, so a failed attempt's snapshots aren't saved. */
  writes: Map<string, string>;
  checked: Set<string>;
  failed: Set<string>;
  inline: InlineEdits;
  inlineFailed: number;
  done: boolean;
}

const storage = new AsyncLocalStorage<Scope>();
// For callbacks with no async context of their own, like a server made in beforeAll
let current: Scope | undefined;
const files = new Map<string, SnapshotFile>();
let mode: SnapshotUpdateMode = "new";
let inlineFailed = 0;

export function resetSnapshots(updateMode: SnapshotUpdateMode) {
  files.clear();
  resetInlineSnapshots();
  inlineFailed = 0;
  current = undefined;
  mode = updateMode;
}

function getFile(testFile: string): SnapshotFile {
  let file = files.get(testFile);

  if (!file) {
    file = new SnapshotFile(testFile);
    files.set(testFile, file);
  }

  return file;
}

/**
 * One per test. Each attempt runs in a fresh scope so a retry starts counting
 * from the same place. Only the last attempt is committed, when the test is done.
 */
/** `testId` is the test's id in the results, see commitInlineEdits. */
export function createSnapshotTest(
  testFile: string,
  testName: string,
  testId: string,
) {
  let last: Scope | undefined;

  return {
    async attempt(fn: () => Promise<void>): Promise<void> {
      const scope: Scope = {
        file: testFile,
        testName,
        counters: new Map(),
        writes: new Map(),
        checked: new Set(),
        failed: new Set(),
        inline: new Map(),
        inlineFailed: 0,
        done: false,
      };

      last = scope;
      current = scope;

      try {
        await storage.run(scope, fn);
      } finally {
        // A timed-out body can still be running. Anything it does from here
        // on must not count toward the next test.
        scope.done = true;
        if (current === scope) current = undefined;
      }
    },

    finish() {
      if (!last) return;

      commitInlineEdits(last.inline, testId);
      inlineFailed += last.inlineFailed;

      if (last.counters.size === 0) return;

      const file = getFile(testFile);

      for (const [name, count] of last.counters) {
        file.counters.set(name, (file.counters.get(name) ?? 0) + count);
      }

      for (const [key, value] of last.writes) file.data.set(key, value);
      for (const key of last.checked) file.checked.add(key);
      for (const key of last.failed) file.failed.add(key);
    },
  };
}

type MatchResult = { pass: true } | { pass: false; message: string };

/**
 * For a file given up on mid-test: its attempt never ends, so the next
 * file's hooks mustn't fall back to that test's scope.
 */
export function dropSnapshotScope(): void {
  current = undefined;
}

function getScope(matcher: string): Scope {
  const scope = storage.getStore() ?? current;

  if (!scope) {
    throw new Error(`${matcher}() can only be called inside a test`);
  }

  if (scope.done) {
    throw new Error(
      `${matcher}() was called after its test finished. Is a timed-out test still running?`,
    );
  }

  return scope;
}

export function matchInline(
  received: unknown,
  snapshot: string | undefined,
  canWrite: boolean,
): MatchResult {
  const scope = getScope("toMatchInlineSnapshot");
  let result: MatchResult;

  try {
    result = matchInlineSnapshot(
      scope.inline,
      mode,
      received,
      snapshot,
      canWrite,
    );
  } catch (err) {
    // Can't be written (a conflict, .resolves), that's a failed snapshot too
    scope.inlineFailed++;
    throw err;
  }

  if (!result.pass) scope.inlineFailed++;

  return result;
}

export function matchSnapshot(received: unknown, hint?: string): MatchResult {
  const scope = getScope("toMatchSnapshot");
  const file = getFile(scope.file);

  if (file.loadError) throw file.loadError;

  const name = hint ? `${scope.testName}: ${hint}` : scope.testName;
  const count = (scope.counters.get(name) ?? 0) + 1;

  scope.counters.set(name, count);

  const key = `${name} ${(file.counters.get(name) ?? 0) + count}`;
  const actual = serialize(received);
  const stored = file.data.get(key);

  scope.checked.add(key);

  if (stored === undefined) {
    if (mode === "none") {
      scope.failed.add(key);

      return {
        pass: false,
        message:
          `New snapshot \`${key}\` was not written. Snapshots aren't written on CI, ` +
          `run with -u to write it.\n\nReceived: ${actual}`,
      };
    }

    scope.writes.set(key, actual);

    return { pass: true };
  }

  if (stored === actual || mode === "all") {
    scope.writes.set(key, actual);

    return { pass: true };
  }

  scope.failed.add(key);

  return {
    pass: false,
    message:
      `Snapshot \`${key}\` doesn't match\n\n${diffLines(actual, stored)}\n\n` +
      "Run with -u to update it if the change is expected.",
  };
}

/**
 * Write what changed and find obsolete snapshots. `keep` lists the names of
 * tests in each file that didn't pass (skipped, filtered out, failed): their
 * unused snapshots aren't obsolete, they just didn't get checked this run.
 */
export function finishSnapshots(
  testFiles: Array<{ file: string; keep: string[] }>,
): {
  summary: SnapshotSummary;
  /** Written with writeInline once every thread is done. */
  inline: InlineSource[];
  /**
   * Snapshot dirs a removed file may have left empty. Removed with
   * removeEmptyDirs once every thread is done, another worker may be about
   * to write in one.
   */
  emptied: string[];
} {
  const emptied: string[] = [];
  const summary: SnapshotSummary = {
    added: 0,
    updated: 0,
    failed: 0,
    obsolete: 0,
    removed: 0,
    filesWritten: [],
    obsoleteKeys: [],
    inlineSkipped: [],
    errors: [],
  };

  for (const { file: testFile, keep } of testFiles) {
    // Don't create (and read) a file for every test file that never used snapshots
    const file = files.get(testFile) ?? peekFile(testFile);

    if (!file) continue;

    // Always reported. Even when a matcher hit it, a retry that didn't call
    // the matcher again could pass, and one nobody used (merge conflict
    // markers) would pass unnoticed.
    if (file.loadError) {
      summary.errors.push({ file: file.path, message: file.loadError.message });
      continue;
    }

    summary.failed += file.failed.size;

    // Counted per file and only added once the file is saved, so a failed
    // write doesn't say "1 written"
    let added = 0;
    let updated = 0;
    const removed: string[] = [];

    for (const [key, value] of file.data) {
      const before = file.saved.get(key);

      if (before === undefined) added++;
      else if (before !== value) updated++;
    }

    for (const key of file.saved.keys()) {
      if (file.checked.has(key) || keep.some((name) => ownsKey(name, key))) {
        continue;
      }

      summary.obsolete++;

      if (mode === "all") {
        file.data.delete(key);
        removed.push(key);
      } else {
        summary.obsoleteKeys.push({ file: file.path, key });
      }
    }

    if (!changed(file)) continue;

    try {
      if (file.data.size === 0) {
        rmSync(file.path, { force: true });
        noteWrite(file.path);
        emptied.push(dirname(file.path));
      } else {
        // A folder it makes changes the one above it too
        const made = mkdirSync(dirname(file.path), { recursive: true });

        if (made) noteWrite(made);
        writeFileSync(file.path, formatSnapshotFile(file.data));
        noteWrite(file.path);
      }
    } catch (err) {
      summary.errors.push({
        file: file.path,
        message: err instanceof Error ? err.message : String(err),
      });

      // Still in the file, so still obsolete
      for (const key of removed) {
        summary.obsoleteKeys.push({ file: file.path, key });
      }

      continue;
    }

    summary.added += added;
    summary.updated += updated;
    summary.removed += removed.length;
    summary.filesWritten.push(file.path);
  }

  files.clear();

  summary.failed += inlineFailed;
  // A worker finishes its files one at a time, each counted once
  inlineFailed = 0;

  return { summary, inline: takeInlineEdits(), emptied };
}

/**
 * Writes the inline snapshots of every thread and adds them to `summary`.
 * `conflicts` are tests to fail, their value conflicts with another worker's.
 */
export function writeInline(
  summary: SnapshotSummary,
  taken: InlineSource[],
): {
  summary: SnapshotSummary;
  conflicts: Array<{ test: string; message: string }>;
} {
  const inline = writeInlineSnapshots(taken);

  return {
    conflicts: inline.conflicts,
    summary: {
      ...summary,
      added: summary.added + inline.added,
      updated: summary.updated + inline.updated,
      filesWritten: [...summary.filesWritten, ...inline.filesWritten],
      inlineSkipped: inline.skipped,
      errors: [...summary.errors, ...inline.errors],
    },
  };
}

function peekFile(testFile: string): SnapshotFile | undefined {
  const file = new SnapshotFile(testFile);

  return file.saved.size > 0 || file.loadError ? file : undefined;
}

function changed(file: SnapshotFile): boolean {
  if (file.data.size !== file.saved.size) return true;

  for (const [key, value] of file.data) {
    if (file.saved.get(key) !== value) return true;
  }

  return false;
}

/** True if `key` is one of test `name`'s snapshots: `name 1` or `name: hint 1`. */
function ownsKey(name: string, key: string): boolean {
  if (key.startsWith(`${name}: `)) return true;

  return key.startsWith(`${name} `) && /^\d+$/.test(key.slice(name.length + 1));
}

export function removeEmptyDirs(dirs: string[]) {
  for (const dir of new Set(dirs)) removeDirIfEmpty(dir);
}

function removeDirIfEmpty(dir: string) {
  try {
    if (readdirSync(dir).length === 0) {
      rmdirSync(dir);
      noteWrite(dir);
    }
  } catch {
    // Not ours to worry about
  }
}
