import { readFileSync } from "node:fs";

import { colors } from "../utils/colors";

const HEADER = "// Unrift Snapshot v1";

// Same escaping as Jest so a value can't close the template literal early.
// A template literal turns a raw \r into \n when it's read, so that's escaped too.
export function escapeTemplate(text: string): string {
  return text.replace(/\\|`|\$\{/g, "\\$&").replace(/\r/g, "\\r");
}

/**
 * Parse a .snap file into key -> value. The file is read, never run: it can
 * come from anyone who sends a pull request, and node:vm is no sandbox.
 */
export function readSnapshotFile(path: string): Map<string, string> {
  // CRLF to LF, then read what's left the way JavaScript does, which
  // turns CRLF and a lone CR into LF
  const source = readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\r\n?/g, "\n");
  let entries: [string, string][];

  try {
    entries = parseSnapshots(source);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Couldn't read snapshot file ${path}: ${reason}`);
  }

  const snapshots = new Map<string, string>();

  for (const [key, value] of entries) {
    // Multi-line values are stored with a newline on each side, see write
    snapshots.set(
      key,
      value.length > 2 && value.startsWith("\n") && value.endsWith("\n")
        ? value.slice(1, -1)
        : value,
    );
  }

  return snapshots;
}

/** Reads `exports[`key`] = `value`;` entries, comments and whitespace. */
function parseSnapshots(source: string): [string, string][] {
  const entries: [string, string][] = [];
  let i = 0;

  const fail = (what: string): never => {
    const line = source.slice(0, i).split("\n").length;
    throw new Error(`${what} on line ${line}`);
  };

  const skip = () => {
    for (;;) {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source.startsWith("//", i)) {
        // Ends at any line terminator, like JavaScript
        const end = source.slice(i).search(/[\n\u2028\u2029]/);
        i = end === -1 ? source.length : i + end;
      } else if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        if (end === -1) fail("Unclosed comment");
        i = end + 2;
      } else return;
    }
  };

  const expect = (text: string) => {
    skip();
    if (!source.startsWith(text, i)) fail(`Expected \`${text}\``);
    i += text.length;
  };

  const template = (): string => {
    skip();
    if (source[i] !== "`") fail("Expected a template literal");
    i++;
    let out = "";

    for (;;) {
      if (i >= source.length) fail("Unclosed template literal");
      const ch = source[i];
      if (ch === "`") {
        i++;
        return out;
      }
      if (ch === "$" && source[i + 1] === "{") fail("Unexpected `${`");
      if (ch !== "\\") {
        out += ch;
        i++;
        continue;
      }
      i++;
      out += escape();
    }
  };

  // Template literal escapes, as JavaScript reads them
  const escape = (): string => {
    const ch = source[i++];
    const simple: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      b: "\b",
      f: "\f",
      v: "\v",
    };
    if (ch === undefined) fail("Unclosed template literal");
    if (ch in simple) return simple[ch];
    if (ch === "\n" || ch === "\u2028" || ch === "\u2029") return "";
    if (ch === "0" && !/[0-9]/.test(source[i] ?? "")) return "\0";
    if (/[0-9]/.test(ch)) fail("Invalid escape");
    if (ch === "x") return code(/^[0-9a-fA-F]{2}/);
    if (ch === "u") {
      if (source[i] !== "{") return code(/^[0-9a-fA-F]{4}/);
      const end = source.indexOf("}", i);
      const hex = end === -1 ? "" : source.slice(i + 1, end);
      if (!/^[0-9a-fA-F]+$/.test(hex) || parseInt(hex, 16) > 0x10ffff)
        fail("Invalid escape");
      i = end + 1;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    return ch;
  };

  const code = (pattern: RegExp): string => {
    const hex = pattern.exec(source.slice(i))?.[0];
    if (!hex) return fail("Invalid escape");
    i += hex.length;
    return String.fromCodePoint(parseInt(hex, 16));
  };

  for (skip(); i < source.length; skip()) {
    expect("exports");
    expect("[");
    const key = template();
    expect("]");
    expect("=");
    const value = template();
    const end = i;
    skip();
    // Without a `;` the next entry has to start on a new line, like JavaScript
    if (source[i] === ";") i++;
    else if (
      i < source.length &&
      !/[\n\u2028\u2029]/.test(source.slice(end, i))
    )
      fail("Expected `;`");
    entries.push([key, value]);
  }

  return entries;
}

export function formatSnapshotFile(snapshots: Map<string, string>): string {
  const entries = [...snapshots.keys()].sort(naturalCompare).map((key) => {
    const value = snapshots.get(key)!;
    const body = value.includes("\n") ? `\n${value}\n` : value;

    return `exports[\`${escapeTemplate(key)}\`] = \`${escapeTemplate(body)}\`;`;
  });

  return `${HEADER}\n\n${entries.join("\n\n")}\n`;
}

/** So `name 2` sorts before `name 10`. */
function naturalCompare(a: string, b: string): number {
  const chunk = /(\d+|\D+)/g;
  const ac = a.match(chunk) ?? [];
  const bc = b.match(chunk) ?? [];

  for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
    const x = ac[i];
    const y = bc[i];

    if (x === y) continue;

    if (/^\d/.test(x) && /^\d/.test(y)) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    }

    return x < y ? -1 : 1;
  }

  return ac.length - bc.length;
}

/** Line diff of the received value against the stored one. */
export function diffLines(received: string, snapshot: string): string {
  const a = received.split("\n");
  const b = snapshot.split("\n");
  const lines: string[] = [];

  // Plain LCS is n*m, give up on a line-level diff for huge snapshots
  if (a.length * b.length > 4_000_000) {
    for (const line of a) lines.push(colors.red(`- ${line}`));
    for (const line of b) lines.push(colors.green(`+ ${line}`));
  } else {
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
      new Array<number>(b.length + 1).fill(0),
    );

    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i][j] =
          a[i] === b[j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;

    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        lines.push(`  ${a[i]}`);
        i++;
        j++;
      } else if (
        i < a.length &&
        (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])
      ) {
        lines.push(colors.red(`- ${a[i]}`));
        i++;
      } else {
        lines.push(colors.green(`+ ${b[j]}`));
        j++;
      }
    }
  }

  return `${colors.red("- Received")} / ${colors.green("+ Snapshot")}\n\n${lines.join("\n")}`;
}
