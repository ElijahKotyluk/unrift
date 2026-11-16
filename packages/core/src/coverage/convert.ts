import { transformSync, type Loader } from "esbuild";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { V8Range, V8ScriptCoverage } from "./collect";
import {
  decodeMappings,
  lineStarts,
  readInlineSourceMap,
  type Mapping,
} from "./sourcemap";
import { globToRegex, isGlobPattern, safeRegExp } from "../utils/helpers";
import { normalizePath } from "../utils/normalizePath";

export type FileCoverage = {
  file: string;
  /** Line number (1-based) to how many times it ran. Only lines with code. */
  lines: Record<number, number>;
  functions: Array<{ name: string; line: number; count: number }>;
  branches: Array<{ line: number; count: number }>;
};

export type CoverageFilter = {
  /** Files outside it aren't reported. */
  root: string;
  include?: string[];
  exclude?: string[];
  /** The run's test files, never reported. */
  testFiles: string[];
};

/** A spot in the code V8 ran, and the line of the source file it came from. */
type Point = {
  offset: number;
  genLine: number;
  file: string;
  line: number;
  column: number;
};

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function toRegExp(pattern: string): RegExp {
  return isGlobPattern(pattern) ? globToRegex(pattern) : safeRegExp(pattern);
}

function createFilter(filter: CoverageFilter) {
  const root = safeRealpath(filter.root);
  const tests = new Set(filter.testFiles.map(safeRealpath));
  const include = (filter.include ?? []).map(toRegExp);
  const exclude = (filter.exclude ?? []).map(toRegExp);
  const seen = new Map<string, string | null>();

  /** The file's real path if it should be reported, otherwise null. */
  return (path: string): string | null => {
    let result = seen.get(path);

    if (result !== undefined) return result;

    const real = safeRealpath(path);
    const rel = normalizePath(relative(root, real));
    const matches = (re: RegExp) =>
      re.test(rel) || re.test(normalizePath(real));

    const wanted =
      rel !== "" &&
      !rel.startsWith("../") &&
      rel !== ".." &&
      !isAbsolute(rel) &&
      !rel.split("/").includes("node_modules") &&
      !tests.has(real) &&
      (include.length === 0 || include.some(matches)) &&
      !exclude.some(matches);

    result = wanted ? real : null;
    seen.set(path, result);

    return result;
  };
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}

function loaderFor(file: string): Loader {
  const ext = extname(file);

  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "ts";
  if (ext === ".tsx") return "tsx";
  if (ext === ".jsx") return "jsx";

  return "js";
}

/** Points of a bundle, mapped back through its inline source map. */
function bundlePoints(
  code: string,
  path: string,
  wanted: (file: string) => string | null,
): Point[] {
  const map = readInlineSourceMap(code);

  if (!map) return [];

  const starts = lineStarts(code);
  const sources = map.sources.map((s) => wanted(resolve(dirname(path), s)));

  return decodeMappings(map.mappings).flatMap((m) => {
    const file = sources[m.source];

    if (!file || m.genLine >= starts.length) return [];

    return [
      {
        offset: starts[m.genLine] + m.genColumn,
        genLine: m.genLine,
        file,
        line: m.line + 1,
        column: m.column,
      },
    ];
  });
}

/**
 * Points of a file Node ran as is. There's no source map, so esbuild finds
 * where the code is: every spot it maps is a spot in this file.
 */
function plainPoints(code: string, path: string, file: string): Point[] {
  const starts = lineStarts(code);
  let mappings: Mapping[];

  try {
    const result = transformSync(code, {
      loader: loaderFor(path),
      sourcemap: "external",
      sourcefile: path,
      logLevel: "silent",
    });

    mappings = decodeMappings(JSON.parse(result.map).mappings);
  } catch {
    // Can't be parsed, count every line that isn't blank
    mappings = starts.flatMap((start, line) => {
      const end = starts[line + 1] ?? code.length;
      const column = code.slice(start, end).search(/\S/);

      return column === -1
        ? []
        : [{ genLine: line, genColumn: 0, source: 0, line, column }];
    });
  }

  const points = new Map<number, Point>();

  for (const m of mappings) {
    if (m.line >= starts.length) continue;

    const offset = starts[m.line] + m.column;

    points.set(offset, {
      offset,
      genLine: m.line,
      file,
      line: m.line + 1,
      column: m.column,
    });
  }

  return [...points.values()];
}

/** How many times each point ran: the count of the innermost range around it. */
function countPoints(points: Point[], ranges: V8Range[]): number[] {
  const counts = new Array<number>(points.length).fill(0);
  const stack: V8Range[] = [];
  let next = 0;

  for (let i = 0; i < points.length; i++) {
    const offset = points[i].offset;

    while (next < ranges.length && ranges[next].startOffset <= offset) {
      const range = ranges[next++];

      while (
        stack.length &&
        stack[stack.length - 1].endOffset <= range.startOffset
      ) {
        stack.pop();
      }

      stack.push(range);
    }

    while (stack.length && stack[stack.length - 1].endOffset <= offset) {
      stack.pop();
    }

    counts[i] = stack.length ? stack[stack.length - 1].count : 0;
  }

  return counts;
}

/** First index in `points` (sorted by offset) at or after `offset`. */
function firstAtOrAfter(points: Point[], offset: number): number {
  let lo = 0;
  let hi = points.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (points[mid].offset < offset) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

/** The first point inside a range. */
function pointInside(points: Point[], range: V8Range): Point | null {
  const i = firstAtOrAfter(points, range.startOffset);

  return i < points.length && points[i].offset < range.endOffset
    ? points[i]
    : null;
}

/**
 * The point a function starts at. It has to be on the same generated line as
 * the function, otherwise it's code esbuild wrapped (a CommonJS module) and
 * not a function in the source.
 */
function functionStart(
  points: Point[],
  range: V8Range,
  genLine: number,
): Point | null {
  const i = firstAtOrAfter(points, range.startOffset);
  const before = points[i - 1];

  if (points[i]?.offset === range.startOffset) return points[i];
  if (before && before.genLine === genLine) return before;

  const inside = points[i];

  return inside && inside.offset < range.endOffset && inside.genLine === genLine
    ? inside
    : null;
}

type Entry = {
  lines: Map<number, number>;
  functions: Map<string, { name: string; line: number; count: number }>;
  /** "line:column" of each branch's first point. */
  branches: Map<string, number>;
  /** How many times each point ran, "line:column" to count. */
  points: Map<string, number>;
};

function scriptPath(url: string): string | null {
  if (!url.startsWith("file:")) return null;

  try {
    return fileURLToPath(url.split("?")[0]);
  } catch {
    return null;
  }
}

/**
 * Turns V8's coverage into coverage of the source files. `bundles` are the
 * URLs of this run's test bundles. Other bundles (an earlier watch run's)
 * are skipped, their code may not match what's on disk anymore.
 */
export function toFileCoverage(
  scripts: V8ScriptCoverage[],
  bundles: Set<string>,
  filter: CoverageFilter,
): FileCoverage[] {
  const wanted = createFilter(filter);
  const bundlePaths = new Set(
    [...bundles].map((url) => scriptPath(url)).filter((p) => p !== null),
  );
  const byFile = new Map<string, Entry>();

  const entryFor = (file: string): Entry => {
    let entry = byFile.get(file);

    if (!entry) {
      entry = {
        lines: new Map(),
        functions: new Map(),
        branches: new Map(),
        points: new Map(),
      };
      byFile.set(file, entry);
    }

    return entry;
  };

  for (const script of scripts) {
    const path = scriptPath(script.url);

    if (!path) continue;

    let code: string;
    let points: Point[];

    try {
      if (bundles.has(script.url)) {
        code = readFileSync(path, "utf8");
        points = bundlePoints(code, path, wanted);
      } else {
        const file = bundlePaths.has(path) ? null : wanted(path);

        if (!file) continue;

        code = readFileSync(path, "utf8");
        points = plainPoints(code, path, file);
      }
    } catch {
      // The file is gone or unreadable, nothing to map it to
      continue;
    }

    if (points.length === 0) continue;

    points.sort((a, b) => a.offset - b.offset);

    const ranges = script.functions
      .flatMap((fn) => fn.ranges)
      .sort(
        (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset,
      );

    const counts = countPoints(points, ranges);

    // A line ran if any code on it ran. Within one script that's the most
    // any of its points ran, across scripts (bundles) it adds up.
    const lineCounts = new Map<string, number>();
    const pointCounts = new Map<string, number>();

    points.forEach((p, i) => {
      const line = `${p.file}\0${p.line}`;
      const point = `${line}\0${p.column}`;

      lineCounts.set(line, Math.max(lineCounts.get(line) ?? 0, counts[i]));
      pointCounts.set(point, Math.max(pointCounts.get(point) ?? 0, counts[i]));
    });

    for (const [key, count] of lineCounts) {
      const [file, line] = key.split("\0");
      const lines = entryFor(file).lines;

      lines.set(Number(line), (lines.get(Number(line)) ?? 0) + count);
    }

    for (const [key, count] of pointCounts) {
      const [file, line, column] = key.split("\0");
      const at = entryFor(file).points;
      const pos = `${line}:${column}`;

      at.set(pos, (at.get(pos) ?? 0) + count);
    }

    const genStarts = lineStarts(code);

    for (const fn of script.functions) {
      const [own, ...blocks] = fn.ranges;

      // The script's own top level isn't a function
      if (own && !(own.startOffset === 0 && fn.functionName === "")) {
        const start = functionStart(
          points,
          own,
          lineOf(genStarts, own.startOffset),
        );

        if (start) {
          const key = `${start.line}:${start.column}`;
          const functions = entryFor(start.file).functions;
          const prev = functions.get(key);

          functions.set(key, {
            name: prev?.name ?? fn.functionName,
            line: start.line,
            count: (prev?.count ?? 0) + own.count,
          });
        }
      }

      // V8 reports a block only when it ran a different number of times
      // than the code around it, so these are the branches it can see. The
      // count comes from the points later: a bundle that left the block out
      // still ran it, as often as the code around it.
      for (const block of blocks) {
        const start = pointInside(points, block);

        if (start) {
          entryFor(start.file).branches.set(
            `${start.line}:${start.column}`,
            start.line,
          );
        }
      }
    }
  }

  return [...byFile.entries()]
    .map(([file, entry]) => ({
      file,
      lines: Object.fromEntries(
        [...entry.lines.entries()].sort((a, b) => a[0] - b[0]),
      ),
      functions: [...entry.functions.values()].sort((a, b) => a.line - b.line),
      branches: [...entry.branches.entries()]
        .map(([pos, line]) => ({ line, count: entry.points.get(pos) ?? 0 }))
        .sort((a, b) => a.line - b.line),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
