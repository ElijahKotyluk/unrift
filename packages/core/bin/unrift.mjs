#!/usr/bin/env node
"use strict";

import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, resolve, isAbsolute } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const projectRoot = resolve(process.cwd());

// Matches:
// - unrift.config.ts/js/mjs/cjs/json
// - unrift.<anything>.config.ts/js/mjs/cjs/json  (e.g. unrift.only.config.mjs)
const CONFIG_RE = /^unrift(?:\.[^.]+)*\.config\.(ts|js|mjs|cjs|json)$/;

function isConfigFileName(name) {
  return CONFIG_RE.test(name);
}

function findConfigPath(startDir = projectRoot) {
  let dir = startDir;

  while (true) {
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      // ignore unreadable dirs
    }

    // Prefer the "default" config if multiple exist in same folder
    const candidates = entries.filter(isConfigFileName).sort((a, b) => {
      const aIsDefault = a.startsWith("unrift.config.");
      const bIsDefault = b.startsWith("unrift.config.");

      if (aIsDefault !== bIsDefault) return aIsDefault ? -1 : 1;
      return a.localeCompare(b);
    });

    if (candidates.length > 0) {
      return join(dir, candidates[0]);
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function getConfigArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") return argv[i + 1] ?? null;
  }
  return null;
}

function isUsingTsLoader() {
  const execArgv = process.execArgv;
  const loaderIndex = execArgv.indexOf("--loader");
  if (loaderIndex === -1) return false;
  return (execArgv[loaderIndex + 1] ?? "").includes("ts-node/esm");
}

function restartWithTsLoader() {
  const thisFile = fileURLToPath(import.meta.url);

  const result = spawnSync(
    process.execPath,
    [
      "--loader",
      "ts-node/esm",
      ...process.execArgv,
      thisFile,
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );

  process.exit(result.status ?? 1);
}

function ensureTsRuntimeAvailable() {
  // In ESM, require() is not defined; use createRequire.
  // Prefer resolving from the user's project root; fallback to this script.
  const requireFromProject = createRequire(
    pathToFileURL(join(projectRoot, "package.json")).href,
  );
  const requireFromHere = createRequire(import.meta.url);

  const canResolve = (req, spec) => {
    try {
      req.resolve(spec);
      return true;
    } catch {
      return false;
    }
  };

  const hasTsNode =
    canResolve(requireFromProject, "ts-node/esm") ||
    canResolve(requireFromHere, "ts-node/esm");
  const hasTypescript =
    canResolve(requireFromProject, "typescript") ||
    canResolve(requireFromHere, "typescript");

  if (hasTsNode && hasTypescript) return;

  console.error(
    "\nUnrift: TypeScript support requires ts-node and typescript.\n\n" +
      "Install them with:\n\n" +
      "  npm install --save-dev ts-node typescript\n\n" +
      "or:\n\n" +
      "  pnpm add -D ts-node typescript\n",
  );
  process.exit(1);
}

function hasTsTests(testDir) {
  if (!existsSync(testDir)) return false;

  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (walk(full)) return true;
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".test.ts"))
      ) {
        return true;
      }
    }

    return false;
  };

  return walk(testDir);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

const argv = process.argv.slice(2);
const configArg = getConfigArg(argv);

const explicitConfigPath = configArg
  ? isAbsolute(configArg)
    ? configArg
    : resolve(projectRoot, configArg)
  : null;

const configPath = explicitConfigPath ?? findConfigPath();

// If config is TS and loader is not active → restart with ts-node/esm
if (configPath?.endsWith(".ts") && !isUsingTsLoader()) {
  ensureTsRuntimeAvailable();
  restartWithTsLoader();
}

// Load config (safe now; TS config only possible after loader restart)
let config = {};
if (configPath) {
  if (configPath.endsWith(".json")) {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } else {
    const mod = await import(pathToFileURL(configPath).href);
    config = mod.default ?? mod.config ?? {};
  }
}

// Resolve testDir from config (relative to cwd)
const testDir = resolve(
  projectRoot,
  typeof config.testDir === "string" ? config.testDir : "test",
);

// If TS tests exist and loader is not active → restart
if (!isUsingTsLoader() && hasTsTests(testDir)) {
  ensureTsRuntimeAvailable();
  restartWithTsLoader();
}

// Run the real CLI
await import("../dist/cli.js");
