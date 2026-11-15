import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { colors } from "../utils/colors";

const HEADER = "// Unrift Snapshot v1";

// Same escaping as Jest so a value can't close the template literal early.
// A template literal turns a raw \r into \n when it's read, so that's escaped too.
function escape(text: string): string {
  return text.replace(/\\|`|\$\{/g, "\\$&").replace(/\r/g, "\\r");
}

/** Parse a .snap file into key -> value. */
export function readSnapshotFile(path: string): Map<string, string> {
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const data: Record<string, unknown> = Object.create(null);

  try {
    runInNewContext(source, { exports: data }, { filename: path });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Couldn't read snapshot file ${path}: ${reason}`);
  }

  const snapshots = new Map<string, string>();

  for (const key of Object.keys(data)) {
    const value = data[key];

    if (typeof value !== "string") continue;

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

export function formatSnapshotFile(snapshots: Map<string, string>): string {
  const entries = [...snapshots.keys()].sort(naturalCompare).map((key) => {
    const value = snapshots.get(key)!;
    const body = value.includes("\n") ? `\n${value}\n` : value;

    return `exports[\`${escape(key)}\`] = \`${escape(body)}\`;`;
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
