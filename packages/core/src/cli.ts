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

function printHelp() {
  console.log(`
Unrift Test Runner

Usage:
  unrift [pattern] [options]

Options:
  -c, --config <path>      Path to config file
  -d, --debug              Enable debug logging
  -l, --list               List discovered test files
  -j, --json               Output test results as JSON
      --cache-clean        Clear transform cache
  -h, --help               Show help

Examples:
  unrift
  unrift math
  unrift -c test/config.ts --debug
`);
}

function parseArgs(argv: string[]) {
  let configPath: string | undefined;
  let pattern: RegExp | undefined;
  let debug = false;
  let help = false;
  let list = false;
  let json = false;
  let cacheClean = false;

  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }

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

    if (a === "--cache-clean" || a === "--clear-cache") {
      cacheClean = true;

      continue;
    }

    // First non-flag arg is pattern
    rest.push(a);
  }

  if (rest[0]) pattern = safeRegExp(rest[0]);

  return { configPath, pattern, debug, list, json, cacheClean, help };
}

const { configPath, pattern, debug, list, json, cacheClean, help } = parseArgs(
  process.argv.slice(2),
);

if (help) {
  printHelp();
  process.exit(0);
}

runTestsCLI({ pattern, configPath, debug, list, json, cacheClean }).catch(
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
