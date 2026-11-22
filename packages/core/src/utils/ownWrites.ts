/**
 * What unrift itself wrote, so watch mode can tell its own writes from the
 * user's. Each path is stamped by mtime and size right as it's written: a
 * change after that, even during the same run, changes the stamp.
 *
 * A worker sends its stamps with its results (see take in run.ts), the
 * watcher is in the main thread.
 */

import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Path to its stamp, kept across runs. Only an unchanged path matches. */
const written = new Map<string, string>();
/** Stamped since the last take, for a worker to send. */
let pending: Array<[string, string]> = [];

function stamp(path: string): string {
  try {
    const st = statSync(path);

    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "missing";
  }
}

function set(path: string) {
  const entry: [string, string] = [path, stamp(path)];

  written.set(entry[0], entry[1]);
  pending.push(entry);
}

/** Call right after writing or removing `path`. */
export function noteWrite(path: string): void {
  const full = resolve(path);

  set(full);
  // Creating or removing a file also shows up as a change to its folder
  set(dirname(full));
}

/** The stamps since the last take. */
export function takeWrites(): Array<[string, string]> {
  const taken = pending;

  pending = [];

  return taken;
}

/** Stamps another thread took. */
export function addWrites(entries: Array<[string, string]>): void {
  for (const [path, value] of entries) written.set(path, value);
}

/** Whether `path` is as unrift left it. */
export function isOwnWrite(path: string): boolean {
  const own = written.get(resolve(path));

  return own !== undefined && own === stamp(path);
}
