import { readFileSync, statSync, writeFileSync } from "node:fs";
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

let runStartedAt = 0;

export function resetInlineSnapshots() {
  sources.clear();
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
    if (!optional) file.missed = true;
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
  }
}

/** Called when a test is done, with its last attempt's edits. */
export function commitInlineEdits(pending: InlineEdits) {
  for (const [path, edits] of pending) {
    const file = getSource(path);

    for (const [start, edit] of edits) {
      if (edit.kind !== "same" || !file.edits.has(start)) {
        file.edits.set(start, edit);
      }
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

/** Write the committed edits into the test files. */
export function writeInlineSnapshots(): {
  added: number;
  updated: number;
  filesWritten: string[];
  skipped: string[];
  errors: Array<{ file: string; message: string }>;
} {
  let added = 0;
  let updated = 0;
  const filesWritten: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ file: string; message: string }> = [];

  for (const [path, file] of sources) {
    if (file.missed) skipped.push(path);

    const edits = [...file.edits.values()]
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

  sources.clear();

  return { added, updated, filesWritten, skipped, errors };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
