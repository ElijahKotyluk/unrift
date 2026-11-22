import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { FileCoverage } from "./convert";
import { normalizePath } from "../utils/normalizePath";
import { noteWrite } from "../utils/ownWrites";

export type CoverageMetric = { covered: number; total: number; pct: number };

export type CoverageTotals = {
  lines: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
};

export type CoverageFileSummary = CoverageTotals & {
  file: string;
  uncoveredLines: number[];
};

export type CoverageSummary = {
  total: CoverageTotals;
  files: CoverageFileSummary[];
};

export const COVERAGE_REPORTERS = ["text", "lcov", "json"] as const;

export type CoverageReporter = (typeof COVERAGE_REPORTERS)[number];

export type CoverageThresholds = Partial<
  Record<"lines" | "functions" | "branches", number>
>;

function metric(covered: number, total: number): CoverageMetric {
  // Nothing to cover counts as covered, same as Istanbul
  const pct = total === 0 ? 100 : Math.floor((covered / total) * 10000) / 100;

  return { covered, total, pct };
}

function count<T>(items: T[], ran: (item: T) => boolean): [number, number] {
  return [items.filter(ran).length, items.length];
}

export function summarize(files: FileCoverage[]): CoverageSummary {
  let lines = [0, 0];
  let functions = [0, 0];
  let branches = [0, 0];

  const summaries = files.map((f) => {
    const lineHits = Object.entries(f.lines).map(([line, hits]) => ({
      line: Number(line),
      hits,
    }));
    const l = count(lineHits, (x) => x.hits > 0);
    const fn = count(f.functions, (x) => x.count > 0);
    const br = count(f.branches, (x) => x.count > 0);

    lines = [lines[0] + l[0], lines[1] + l[1]];
    functions = [functions[0] + fn[0], functions[1] + fn[1]];
    branches = [branches[0] + br[0], branches[1] + br[1]];

    return {
      file: f.file,
      lines: metric(...l),
      functions: metric(...fn),
      branches: metric(...br),
      uncoveredLines: lineHits.filter((x) => x.hits === 0).map((x) => x.line),
    };
  });

  return {
    total: {
      lines: metric(lines[0], lines[1]),
      functions: metric(functions[0], functions[1]),
      branches: metric(branches[0], branches[1]),
    },
    files: summaries,
  };
}

/** 1, 2, 3, 7 becomes "1-3, 7". */
export function formatLineRanges(lines: number[]): string {
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    let j = i;

    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;

    parts.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j + 1;
  }

  return parts.join(", ");
}

/** The terminal table. Paths are relative to `root`. */
export function formatCoverageTable(
  summary: CoverageSummary,
  root: string,
): string[] {
  const pct = (m: CoverageMetric) => `${m.pct.toFixed(2)}%`;
  const rows = [
    ["File", "Lines", "Functions", "Branches", "Uncovered lines"],
    ...summary.files.map((f) => [
      normalizePath(relative(root, f.file)),
      pct(f.lines),
      pct(f.functions),
      pct(f.branches),
      formatLineRanges(f.uncoveredLines),
    ]),
    [
      "All files",
      pct(summary.total.lines),
      pct(summary.total.functions),
      pct(summary.total.branches),
      "",
    ],
  ];

  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((row) => row[col].length)),
  );

  return rows.map((row) =>
    row
      .map((cell, col) =>
        col === 0 || col === row.length - 1
          ? cell.padEnd(widths[col])
          : cell.padStart(widths[col]),
      )
      .join("   ")
      .trimEnd(),
  );
}

/** lcov.info, what Codecov, Coveralls and editors read. */
export function toLcov(files: FileCoverage[]): string {
  const out: string[] = [];

  for (const f of files) {
    out.push("TN:", `SF:${f.file}`);

    // Function names have to be unique within a file
    const used = new Set<string>();

    for (const [i, fn] of f.functions.entries()) {
      let name = fn.name || `(anonymous_${i})`;

      if (used.has(name)) name = `${name}_${fn.line}`;
      used.add(name);

      out.push(`FN:${fn.line},${name}`, `FNDA:${fn.count},${name}`);
    }

    out.push(
      `FNF:${f.functions.length}`,
      `FNH:${f.functions.filter((fn) => fn.count > 0).length}`,
    );

    for (const [i, br] of f.branches.entries()) {
      out.push(`BRDA:${br.line},${i},0,${br.count}`);
    }

    out.push(
      `BRF:${f.branches.length}`,
      `BRH:${f.branches.filter((br) => br.count > 0).length}`,
    );

    const lines = Object.entries(f.lines);

    for (const [line, hits] of lines) out.push(`DA:${line},${hits}`);

    out.push(
      `LF:${lines.length}`,
      `LH:${lines.filter(([, hits]) => hits > 0).length}`,
      "end_of_record",
    );
  }

  return out.join("\n") + "\n";
}

/** coverage-summary.json, the same layout as Istanbul's json-summary. */
export function toJsonSummary(summary: CoverageSummary): string {
  const shape = (m: CoverageTotals) => ({
    lines: { ...m.lines, skipped: 0 },
    functions: { ...m.functions, skipped: 0 },
    branches: { ...m.branches, skipped: 0 },
  });

  const out: Record<string, unknown> = { total: shape(summary.total) };

  for (const f of summary.files) out[f.file] = shape(f);

  return JSON.stringify(out, null, 2) + "\n";
}

/** Writes the lcov and json reports. Returns the paths written. */
export function writeCoverageReports(
  files: FileCoverage[],
  summary: CoverageSummary,
  reporters: CoverageReporter[],
  dir: string,
): string[] {
  const written: string[] = [];
  const write = (name: string, text: string) => {
    mkdirSync(dir, { recursive: true });

    const path = join(dir, name);

    writeFileSync(path, text);
    noteWrite(path);
    written.push(path);
  };

  if (reporters.includes("lcov")) write("lcov.info", toLcov(files));
  if (reporters.includes("json")) {
    write("coverage-summary.json", toJsonSummary(summary));
  }

  return written;
}

/** A message for each metric under its threshold. */
export function checkThresholds(
  total: CoverageTotals,
  thresholds: CoverageThresholds | undefined,
): string[] {
  const failures: string[] = [];

  for (const key of ["lines", "functions", "branches"] as const) {
    const min = thresholds?.[key];

    if (min !== undefined && total[key].pct < min) {
      failures.push(
        `Coverage for ${key} (${total[key].pct}%) is below the ${min}% threshold`,
      );
    }
  }

  return failures;
}

export function assertValidCoverageConfig(
  reporters: unknown,
  thresholds: unknown,
): asserts reporters is CoverageReporter[] {
  if (
    !Array.isArray(reporters) ||
    reporters.some((r) => !COVERAGE_REPORTERS.includes(r))
  ) {
    throw new Error(
      `coverage reporter must be one of ${COVERAGE_REPORTERS.map((r) => `"${r}"`).join(", ")}, got ${JSON.stringify(reporters)}`,
    );
  }

  if (thresholds === undefined) return;

  const valid =
    typeof thresholds === "object" &&
    thresholds !== null &&
    Object.entries(thresholds).every(
      ([key, value]) =>
        ["lines", "functions", "branches"].includes(key) &&
        typeof value === "number" &&
        value >= 0 &&
        value <= 100,
    );

  if (!valid) {
    throw new Error(
      `coverage thresholds must be numbers from 0 to 100 for lines, functions or branches, got ${JSON.stringify(thresholds)}`,
    );
  }
}
