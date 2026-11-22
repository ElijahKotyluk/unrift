import { readFileSync, statSync, writeFileSync } from "node:fs";
import { threadId } from "node:worker_threads";
import { SourceMap } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { diffLines, escapeTemplate } from "./file";
import { serialize } from "./serialize";
import type { SnapshotUpdateMode } from "./state";

// Frames from Unrift itself are skipped when looking for the call site
const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "..") + sep;

const NAME = "toMatchInlineSnapshot";

export interface InlineEdit {
  /** Replaces source.slice(start, end), the text between the parens. */
  start: number;
  end: number;
  value: string;
  indent: string;
  /**
   * "same" records a call that matched under -u, so a loop that also hits a
   * different value is caught. "conflict" blocks the spot from being written.
   */
  kind: "new" | "update" | "same" | "conflict";
  /**
   * Ids of the tests whose call here passed, equal values included. A
   * conflict between workers fails each of them, once per spot.
   */
  tests?: string[];
  /** Tests whose call here already failed in their own worker, and counted. */
  failed?: string[];
}

/** Edits by file, then by where the argument starts. */
export type InlineEdits = Map<string, Map<number, InlineEdit>>;

interface SourceFile {
  /** The file as it was bundled. Offsets are into this, not what's on disk now. */
  source: string;
  lineStarts: number[];
  /** From tests that are done. A test's own edits are held until then, see state.ts. */
  edits: Map<number, InlineEdit>;
  /** Changed after the run started, so the code that ran isn't what's on disk. */
  stale: boolean;
  /** A stale file a snapshot couldn't be written to, reported as skipped. */
  missed: boolean;
}

const sources = new Map<string, SourceFile>();
const sourceMaps = new Map<string, SourceMap | null>();
// What changed since the last takeInlineEdits: the spots of each source, a
// source with none is new or missed a write. A take looks only at these.
const changed = new Map<string, Set<number>>();
// How many of each spot's test ids a take sent, by source and spot
const sent = new Map<string, Map<number, { tests: number; failed: number }>>();

let runStartedAt = 0;

export function resetInlineSnapshots() {
  sources.clear();
  sent.clear();
  changed.clear();
  sourceMaps.clear();
  runStartedAt = Date.now();
}

/**
 * Multi-line inline snapshots are written indented to match the code, undo
 * that. The first content line is never indented by the serializer itself, so
 * its indentation is exactly what was added.
 */
export function stripIndentation(snapshot: string): string {
  const lines = snapshot.split("\n");

  if (
    lines.length < 3 ||
    lines[0].trim() !== "" ||
    lines[lines.length - 1].trim() !== ""
  ) {
    return snapshot;
  }

  const body = lines.slice(1, -1);
  const first = body.find((line) => line.trim() !== "");
  const indent = first?.match(/^[ \t]*/)?.[0] ?? "";

  if (!body.every((line) => line.trim() === "" || line.startsWith(indent))) {
    return snapshot;
  }

  return body
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : ""))
    .join("\n");
}

function formatInline(value: string, indent: string, eol: string): string {
  const escaped = escapeTemplate(value);

  if (!value.includes("\n")) return `\`${escaped}\``;

  const inner = indent + "  ";
  const lines = escaped.split("\n").map((line) => (line ? inner + line : line));

  return `\`${eol}${lines.join(eol)}${eol}${indent}\``;
}

export function matchInlineSnapshot(
  pending: InlineEdits,
  mode: SnapshotUpdateMode,
  received: unknown,
  snapshot: string | undefined,
  canWrite: boolean,
): { pass: true } | { pass: false; message: string } {
  const actual = serialize(received);
  const stored =
    snapshot === undefined ? undefined : stripIndentation(snapshot);

  if (stored === actual) {
    if (mode === "all" && canWrite) queueEdit(pending, actual, "same");

    return { pass: true };
  }

  if (stored !== undefined && mode !== "all") {
    return {
      pass: false,
      message:
        `Inline snapshot doesn't match\n\n${diffLines(actual, stored)}\n\n` +
        "Run with -u to update it if the change is expected.",
    };
  }

  if (stored === undefined && mode === "none") {
    return {
      pass: false,
      message:
        "New inline snapshot was not written. Snapshots aren't written on CI, " +
        `run with -u to write it.\n\nReceived: ${actual}`,
    };
  }

  // The call site isn't on the stack once .resolves has awaited
  if (!canWrite) {
    throw new Error(
      `${NAME}() can't write a snapshot under .resolves/.rejects. Await the value first and snapshot that.`,
    );
  }

  queueEdit(pending, actual, stored === undefined ? "new" : "update");

  return { pass: true };
}

function queueEdit(
  pending: InlineEdits,
  value: string,
  kind: InlineEdit["kind"],
) {
  // Only recorded to catch conflicts, nothing to write
  const optional = kind === "same";
  const site = findCallSite();

  if (!site) {
    if (optional) return;

    throw new Error(
      `Couldn't find where ${NAME}() was called, so the snapshot can't be written.`,
    );
  }

  const file = getSource(site.file, site.content);

  if (file.stale) {
    if (!optional && !file.missed) {
      file.missed = true;
      markChanged(site.file);
    }
    return;
  }

  const offset = (file.lineStarts[site.line] ?? Infinity) + site.column;
  const args = findArgs(file.source, offset);

  if (!args) {
    if (optional) return;

    throw new Error(
      `Can't write the inline snapshot at ${site.file}:${site.line + 1}:${site.column + 1}. ` +
        `${NAME}() needs no argument or a single string or template literal (no \${...}).`,
    );
  }

  let edits = pending.get(site.file);

  if (!edits) {
    edits = new Map();
    pending.set(site.file, edits);
  }

  // The same spot hit again (a loop, a helper shared by tests) with a
  // different value can't be written. Nothing is written there, not even the first.
  const existing = edits.get(args.start) ?? file.edits.get(args.start);

  if (existing && (existing.kind === "conflict" || existing.value !== value)) {
    edits.set(args.start, { ...args, value, kind: "conflict" });

    throw new Error(
      `${NAME}() at ${site.file}:${site.line + 1} ran more than once with different values`,
    );
  }

  // A "same" never replaces a pending write for this spot
  if (!existing || existing.kind === "same") {
    edits.set(args.start, { ...args, value, kind });
  } else if (!edits.has(args.start)) {
    // Another test's write with the same value: nothing to write, but this
    // test ran the spot too and fails with it on a conflict between workers
    edits.set(args.start, { ...args, value, kind: "same" });
  }
}

/** Called when a test is done, with its last attempt's edits. */
export function commitInlineEdits(pending: InlineEdits, testId?: string) {
  for (const [path, edits] of pending) {
    const file = getSource(path);

    for (const [start, edit] of edits) {
      const prev = file.edits.get(start);
      // Added to in place, a spot every test hits would be copied each time
      const tests = prev?.tests ?? [];
      const failed = prev?.failed ?? [];

      // A conflict in a test's own edits means its call here threw
      if (testId) (edit.kind === "conflict" ? failed : tests).push(testId);

      // A "same" never replaces a pending write, it still counts the test
      if (edit.kind !== "same" || !prev) {
        file.edits.set(start, { ...edit, tests, failed });
      }

      markChanged(path, start);
    }
  }
}

function getSource(path: string, bundled?: string): SourceFile {
  let file = sources.get(path);

  if (!file) {
    const source = bundled ?? readFileSync(path, "utf8");
    const lineStarts = [0];

    // Same line breaks as the source map: \r\n, \r, \n, U+2028 and U+2029
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];

      if (ch === "\r" && source[i + 1] === "\n") i++;

      if (ch === "\r" || ch === "\n" || ch === "\u2028" || ch === "\u2029") {
        lineStarts.push(i + 1);
      }
    }

    // A bundled file has the source it was built from. A plain .js file (or a
    // helper it imports) is read now, so it only matches what ran if it wasn't
    // touched since the run started.
    file = {
      source,
      lineStarts,
      edits: new Map(),
      stale: bundled === undefined && modifiedSince(path, runStartedAt),
      missed: false,
    };
    sources.set(path, file);
    // Sent once even with no edits, other threads' copies are checked against it
    markChanged(path);
  }

  return file;
}

function modifiedSince(path: string, time: number): boolean {
  try {
    return statSync(path).mtimeMs > time;
  } catch {
    return true;
  }
}

/** Where the matcher was called from, in the original source (0-based). */
function findCallSite():
  | { file: string; line: number; column: number; content?: string }
  | undefined {
  const frame = callerFrames().find((f) => {
    const name = f.getFileName();

    return (
      name && !name.startsWith("node:") && !toPath(name).startsWith(coreDir)
    );
  });

  const fileName = frame?.getFileName();
  const line = frame?.getLineNumber();
  const column = frame?.getColumnNumber();

  if (!fileName || !line || !column) return undefined;

  const path = toPath(fileName);
  const map = getSourceMap(path);

  if (!map) return { file: path, line: line - 1, column: column - 1 };

  const entry = map.findEntry(line - 1, column - 1) as {
    originalSource?: string;
    originalLine?: number;
    originalColumn?: number;
  };

  if (!entry.originalSource || entry.originalLine === undefined)
    return undefined;

  // The source as it was bundled, so an edit made since doesn't shift offsets
  const { sources: names, sourcesContent } = map.payload as {
    sources?: string[];
    sourcesContent?: Array<string | null>;
  };
  const content =
    sourcesContent?.[names?.indexOf(entry.originalSource) ?? -1] ?? undefined;

  return {
    // Source map paths are URL-encoded (café -> caf%C3%A9, # -> %23)
    file: fileURLToPath(new URL(entry.originalSource, pathToFileURL(path))),
    line: entry.originalLine,
    column: entry.originalColumn ?? 0,
    content,
  };
}

function callerFrames(): NodeJS.CallSite[] {
  const prepare = Error.prepareStackTrace;
  const limit = Error.stackTraceLimit;

  try {
    Error.stackTraceLimit = 50;
    Error.prepareStackTrace = (_err, frames) => frames;

    const holder: { stack?: unknown } = {};

    Error.captureStackTrace(holder);

    return Array.isArray(holder.stack) ? holder.stack : [];
  } finally {
    Error.prepareStackTrace = prepare;
    Error.stackTraceLimit = limit;
  }
}

function toPath(name: string): string {
  return name.startsWith("file://") ? fileURLToPath(name) : name;
}

/** Test files are bundled with an inline source map, plain .js ones aren't. */
function getSourceMap(path: string): SourceMap | null {
  if (sourceMaps.has(path)) return sourceMaps.get(path)!;

  let map: SourceMap | null = null;

  try {
    const code = readFileSync(path, "utf8");
    const match = code.match(
      /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/,
    );

    if (match) {
      map = new SourceMap(
        JSON.parse(Buffer.from(match[1], "base64").toString("utf8")),
      );
    }
  } catch {
    map = null;
  }

  sourceMaps.set(path, map);

  return map;
}

/**
 * From the matcher name at `offset`, find the text between the parens. Only
 * no argument or one string/template literal is supported, anything else
 * (a variable, property matchers) returns undefined.
 */
function findArgs(
  source: string,
  offset: number,
): { start: number; end: number; indent: string } | undefined {
  if (!source.startsWith(NAME, offset)) return undefined;

  let i = skipSpace(source, offset + NAME.length);

  if (source[i] !== "(") return undefined;

  const start = i + 1;

  i = skipSpace(source, start);

  const quote = source[i];

  if (quote === "`" || quote === '"' || quote === "'") {
    i++;

    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") i++;
      else if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
        return undefined;
      } else if (quote !== "`" && source[i] === "\n") return undefined;

      i++;
    }

    if (i >= source.length) return undefined;

    i = skipSpace(source, i + 1);

    if (source[i] === ",") i = skipSpace(source, i + 1);
  }

  if (source[i] !== ")") return undefined;

  const lineStart = source.lastIndexOf("\n", offset) + 1;
  const indent = source.slice(lineStart).match(/^[ \t]*/)![0];

  return { start, end: i, indent };
}

function skipSpace(source: string, i: number): number {
  while (i < source.length && /\s/.test(source[i])) i++;

  return i;
}

/** What changed in a source file's committed edits since the thread's last take. */
export type InlineSource = {
  /** The thread that saw them. Its takes of a file add up, in order. */
  thread: number;
  path: string;
  /** Only in the thread's first take of the file. */
  source?: string;
  /**
   * The spots that changed since its last take. Their `tests` and `failed`
   * are the ids added since, a later take's add to an earlier one's.
   */
  edits: InlineEdit[];
  missed: boolean;
};

/**
 * This thread's committed edits since its last take. Workers send them to
 * the main thread after each file. They're kept here, so the next file's
 * tests still check against them, the way they do without workers.
 */
export function takeInlineEdits(): InlineSource[] {
  const taken: InlineSource[] = [];

  for (const [path, spots] of changed) {
    const file = sources.get(path)!;
    const first = !sent.has(path);
    const counts = sent.get(path) ?? new Map();
    const edits: InlineEdit[] = [];

    // A spot's test lists only grow (commitInlineEdits): only the ids added
    // since are sent
    for (const start of spots) {
      const edit = file.edits.get(start)!;
      const count = counts.get(start) ?? { tests: 0, failed: 0 };

      edits.push({
        ...edit,
        tests: edit.tests?.slice(count.tests),
        failed: edit.failed?.slice(count.failed),
      });
      counts.set(start, {
        tests: edit.tests?.length ?? 0,
        failed: edit.failed?.length ?? 0,
      });
    }

    taken.push({
      thread: threadId,
      path,
      source: first ? file.source : undefined,
      edits,
      missed: file.missed,
    });
    sent.set(path, counts);
  }

  changed.clear();

  return taken;
}

function markChanged(path: string, start?: number) {
  let spots = changed.get(path);

  if (!spots) {
    spots = new Set();
    changed.set(path, spots);
  }

  if (start !== undefined) spots.add(start);
}

/**
 * Write the edits into the source files, each file once. Edits from more than
 * one thread are merged first: two test files in different workers can run
 * the same helper.
 */
export function writeInlineSnapshots(taken: InlineSource[]): {
  added: number;
  updated: number;
  filesWritten: string[];
  skipped: string[];
  errors: Array<{ file: string; message: string }>;
  /** Tests whose values conflict with a test's in another worker. */
  conflicts: Array<{ test: string; message: string }>;
} {
  const conflicts: Array<{ test: string; message: string }> = [];
  let added = 0;
  let updated = 0;
  const filesWritten: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ file: string; message: string }> = [];
  const merged = new Map<
    string,
    {
      source: string;
      // What each thread saw at each spot
      spots: Map<number, InlineEdit[]>;
      missed: boolean;
      // Seen in two versions, nothing is written to it
      mismatched: boolean;
    }
  >();

  // Each thread's takes of a file added up: the first has the source, the
  // later ones what changed
  const byThread = new Map<
    string,
    {
      path: string;
      source?: string;
      edits: Map<number, InlineEdit>;
      missed: boolean;
    }
  >();

  for (const take of taken) {
    const key = `${take.thread}\0${take.path}`;
    let seen = byThread.get(key);

    if (!seen) {
      seen = { path: take.path, edits: new Map(), missed: false };
      byThread.set(key, seen);
    }

    if (take.source !== undefined) seen.source = take.source;
    if (take.missed) seen.missed = true;

    for (const edit of take.edits) {
      const prev = seen.edits.get(edit.start);
      // Own lists, added to in place: a spot every file hits comes in each take
      const tests = prev?.tests ?? [];
      const failed = prev?.failed ?? [];

      tests.push(...(edit.tests ?? []));
      failed.push(...(edit.failed ?? []));
      seen.edits.set(edit.start, { ...edit, tests, failed });
    }
  }

  for (const thread of byThread.values()) {
    // Its first take never came in, without the source the offsets mean nothing
    if (thread.source === undefined) {
      errors.push({
        file: thread.path,
        message:
          "Inline snapshots from a worker came in without the source they were taken from",
      });
      continue;
    }

    let file = merged.get(thread.path);

    if (!file) {
      file = {
        source: thread.source,
        spots: new Map(),
        missed: false,
        mismatched: false,
      };
      merged.set(thread.path, file);
    }

    if (thread.missed) file.missed = true;

    // Bundled from different versions, the offsets don't line up
    if (thread.source !== file.source) file.mismatched = true;

    for (const edit of thread.edits.values()) {
      file.spots.set(edit.start, [...(file.spots.get(edit.start) ?? []), edit]);
    }
  }

  // Decided per spot once every thread is in, so the order they finished in
  // doesn't matter
  const resolved = new Map<string, InlineEdit[]>();

  for (const [path, file] of merged) {
    if (file.mismatched) {
      file.missed = true;
      continue;
    }

    const edits: InlineEdit[] = [];

    for (const seen of file.spots.values()) {
      const values = new Set(
        seen.filter((e) => e.kind !== "conflict").map((e) => e.value),
      );

      // One thread: its own check already ran
      if (
        seen.length === 1 ||
        (values.size === 1 && seen.every((e) => e.kind !== "conflict"))
      ) {
        edits.push(
          seen.find((e) => e.kind === "new" || e.kind === "update") ?? seen[0],
        );
        continue;
      }

      // Different values in different workers. Like a run without workers,
      // where the test that hit it fails, but every one of them: there's no
      // telling which ran first.
      const line = file.source
        .slice(0, seen[0].start)
        .split(/\r\n|\r|\n/).length;
      const message = `${NAME}() at ${path}:${line} ran with different values in different test files`;
      // Each test that passed here fails once for this spot. One whose call
      // here already failed in its worker was counted there.
      const failed = new Set(seen.flatMap((e) => e.failed ?? []));
      const tests = new Set(
        seen.flatMap((e) => e.tests ?? []).filter((t) => !failed.has(t)),
      );

      for (const test of tests) conflicts.push({ test, message });

      if (tests.size === 0 && failed.size === 0) {
        errors.push({ file: path, message });
      }
    }

    resolved.set(path, edits);
  }

  for (const [path, file] of merged) {
    if (file.missed) skipped.push(path);

    const edits = (resolved.get(path) ?? [])
      .filter((edit) => edit.kind === "new" || edit.kind === "update")
      .sort((a, b) => b.start - a.start);

    if (edits.length === 0) continue;

    let current: string;

    // Can't be read back, the matcher passed expecting this to land
    try {
      current = readFileSync(path, "utf8");
    } catch (err) {
      errors.push({ file: path, message: errorMessage(err) });
      continue;
    }

    // Edited since it was bundled (watch mode, an editor save). Offsets are stale.
    if (current !== file.source) {
      skipped.push(path);
      continue;
    }

    let source = file.source;
    // Keep the file's line endings. The template literal reads \r\n back as \n.
    const eol = source.includes("\r\n") ? "\r\n" : "\n";

    for (const edit of edits) {
      source =
        source.slice(0, edit.start) +
        formatInline(edit.value, edit.indent, eol) +
        source.slice(edit.end);
    }

    // Not a skip: the matcher passed expecting this to land, so the run fails
    try {
      writeFileSync(path, source);
    } catch (err) {
      errors.push({ file: path, message: errorMessage(err) });
      continue;
    }

    filesWritten.push(path);

    for (const edit of edits) {
      if (edit.kind === "new") added++;
      else updated++;
    }
  }

  return { added, updated, filesWritten, skipped, errors, conflicts };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
