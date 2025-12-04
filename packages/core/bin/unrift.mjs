#!/usr/bin/env node
"use strict";

import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

const rootDir = resolve(process.cwd());

const CONFIG_BASENAME = "unrift.config";
const CONFIG_EXTS = [".js", ".ts", ".json", ".mjs", ".cjs"];

function findUnriftConfig(startDir = rootDir) {
  let dir = startDir;

  while (true) {
    for (const ext of CONFIG_EXTS) {
      const configPath = join(dir, CONFIG_BASENAME + ext);
      if (existsSync(configPath)) return configPath;
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

const configPath = findUnriftConfig();

if (configPath) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const config = await import(configPath);
}

await import("../dist/cli.js");
