#!/usr/bin/env node
import { runTestsCLI } from "./runner";

function safeRegExp(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid pattern regex "${source}": ${msg}`);
  }
}

function parseArgs(argv: string[]) {
  let configPath: string | undefined;
  let pattern: RegExp | undefined;
  let debug = false;
  let list = false;
  let json = false;

  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--config" || a === "-c") {
      const next = argv[i + 1];
      if (!next) throw new Error(`${a} requires a path`);
      configPath = next;
      i++;
      continue;
    }

    if (a === "--debug" || a === "-d") {
      debug = true;
      continue;
    }

    if (a === "--list" || a === "-l") {
      list = true;
      continue;
    }

    if (a === "--json" || a === "-j") {
      json = true;
      continue;
    }

    // backward compat: first non-flag arg is pattern
    rest.push(a);
  }

  if (rest[0]) pattern = safeRegExp(rest[0]);

  return { configPath, pattern, debug, list, json };
}

const { configPath, pattern, debug, list, json } = parseArgs(
  process.argv.slice(2),
);

runTestsCLI({ pattern, configPath, debug, list, json }).catch((err) => {
  console.error(err);
  process.exit(1);
});
