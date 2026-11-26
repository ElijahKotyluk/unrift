#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerModuleLoader } from "./mock/register-loader.js";
import { runTestsCLI, watchTestsCLI } from "./runner.js";
import { safeRegExp } from "./utils/helpers.js";

// Install the module-mock loader before any test file is imported. Both the
// core bin and the unrift wrapper bin run this CLI, so this is the single
// place module mocking is bootstrapped.
registerModuleLoader();

const __cliDir = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // Walk up from current file to find package.json (works from both src/ and dist/esm/)
  let dir = __cliDir;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(dir, "package.json"), "utf8"),
      );
      if (pkg.name === "@unrift/core") return pkg.version;
    } catch {
      // No package.json here, keep walking up
    }
    dir = resolve(dir, "..");
  }
  return "0.0.0";
}

const version = readVersion();

function printHelp() {
  console.log(`
Unrift Test Runner v${version}

Usage:
  unrift [pattern] [options]

Options:
  -c, --config <path>      Path to config file
  -g, --grep <pattern>     Only run tests whose full name matches (regex)
  -b, --bail               Stop on first test failure
  -t, --timeout <ms>       Default test timeout in milliseconds
      --workers <n>        Run test files in n worker threads
  -w, --watch              Re-run tests on file changes
  -u, --update-snapshots   Rewrite failing snapshots and remove obsolete ones
      --coverage           Report code coverage
      --coverage-reporter <name>
                           text, lcov or json, repeat for more than one
  -d, --debug              Enable debug logging
  -l, --list               List discovered test files
  -j, --json               Output test results as JSON
      --cache-clean        Clear transform cache
  -v, --version            Show version
  -h, --help               Show help

Examples:
  unrift
  unrift math
  unrift --grep "adds numbers"
  unrift -c test/config.ts --bail
  unrift --timeout 10000
  unrift --workers 4
  unrift --watch
  unrift -u
  unrift --coverage --coverage-reporter lcov
`);
}

function parseArgs(argv: string[]) {
  let configPath: string | undefined;
  let pattern: RegExp | undefined;
  let grep: RegExp | undefined;
  let timeoutMs: number | undefined;
  let workers: number | undefined;
  let bail: boolean | undefined;
  let debug = false;
  let help = false;
  let showVersion = false;
  let list = false;
  let json = false;
  let cacheClean = false;
  let watch = false;
  let updateSnapshots = false;
  let coverage = false;
  let coverageReporters: string[] | undefined;

  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }

    if (a === "--version" || a === "-v") {
      showVersion = true;
      continue;
    }

    if (a === "--config" || a === "-c") {
      const next = argv[i + 1];

      if (!next) throw new Error(`${a} requires a path`);

      configPath = next;
      i++;

      continue;
    }

    if (a === "--grep" || a === "-g") {
      const next = argv[i + 1];

      if (!next) throw new Error(`${a} requires a pattern`);

      grep = safeRegExp(next);
      i++;

      continue;
    }

    if (a === "--bail" || a === "-b") {
      bail = true;

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

    if (a === "--timeout" || a === "-t") {
      const next = argv[i + 1];

      if (!next) throw new Error(`${a} requires a value in milliseconds`);

      timeoutMs = parseInt(next, 10);

      if (Number.isNaN(timeoutMs)) throw new Error(`Invalid timeout: ${next}`);

      i++;

      continue;
    }

    if (a === "--workers") {
      const next = argv[i + 1];

      if (!next) throw new Error(`${a} requires a number`);

      workers = Number(next);

      if (!Number.isInteger(workers) || workers < 1) {
        throw new Error(
          `Invalid workers: ${next}, use a whole number of 1 or more`,
        );
      }

      i++;

      continue;
    }

    if (a === "--watch" || a === "-w") {
      watch = true;

      continue;
    }

    if (a === "--update-snapshots" || a === "-u") {
      updateSnapshots = true;

      continue;
    }

    if (a === "--coverage") {
      coverage = true;

      continue;
    }

    if (a === "--coverage-reporter") {
      const next = argv[i + 1];

      if (!next) throw new Error(`${a} requires a reporter name`);

      // A reporter turns coverage on, it's no use without it
      coverage = true;
      coverageReporters = [...(coverageReporters ?? []), ...next.split(",")];
      i++;

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

  return {
    configPath,
    pattern,
    grep,
    timeoutMs,
    workers,
    bail,
    debug,
    list,
    json,
    cacheClean,
    watch,
    updateSnapshots,
    coverage,
    coverageReporters,
    help,
    showVersion,
  };
}

const {
  configPath,
  pattern,
  grep,
  timeoutMs,
  workers,
  bail,
  debug,
  list,
  json,
  cacheClean,
  watch,
  updateSnapshots,
  coverage,
  coverageReporters,
  help,
  showVersion,
} = parseArgs(process.argv.slice(2));

if (showVersion) {
  console.log(version);
  process.exit(0);
}

if (help) {
  printHelp();
  process.exit(0);
}

const runOpts = {
  pattern,
  grep,
  configPath,
  timeoutMs,
  workers,
  bail,
  debug,
  list,
  json,
  cacheClean,
  updateSnapshots,
  coverage: coverage || undefined,
  coverageReporters,
};

(watch ? watchTestsCLI(runOpts) : runTestsCLI(runOpts)).catch((err) => {
  console.error(err);
  process.exit(1);
});
