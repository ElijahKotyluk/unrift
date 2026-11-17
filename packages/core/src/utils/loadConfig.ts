import { toImportUrl } from "./transform";
import { toError } from "./toError";

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { UnriftConfigOptions } from "./defineConfig";

/**
 * Regex to match valid Unrift config file names.
 * Matches:
 * - unrift.config.ts/js/mjs/cjs/json
 * - unrift.<anything>.config.ts/js/mjs/cjs/json  (e.g. unrift.only.config.mjs)
 */
const CONFIG_RE = /^unrift(?:\.[^.]+)*\.config\.(ts|js|mjs|cjs|json)$/;

export type LoadedConfig = {
  config: UnriftConfigOptions;
  // Absolute path to the config file on disk.
  configPath: string;
  // Absolute directory containing the config file.
  configDir: string;
};

function isConfigFileName(name: string): boolean {
  return CONFIG_RE.test(name);
}

const requireCache = createRequire(import.meta.url).cache;

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

async function importConfigFile(configPath: string): Promise<unknown> {
  if (configPath.endsWith(".json")) {
    try {
      const raw = readFileSync(configPath, "utf8");

      return JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Failed to parse JSON config at ${configPath}: ${toError(err).message}`,
      );
    }
  }

  let url = await toImportUrl(configPath, "bundle-config");

  // A bundled config gets a new URL when anything in it changes. One Node
  // runs as is keeps its URL, so watch mode would get the cached module:
  // version it by its contents, and drop CommonJS from require's cache.
  if (url === pathToFileURL(configPath).href) {
    for (const key of [configPath, safeRealpath(configPath)]) {
      delete requireCache[key];
    }

    const hash = createHash("sha256")
      .update(readFileSync(configPath))
      .digest("hex")
      .slice(0, 16);

    url += `?v=${hash}`;
  }

  const module = await import(url);

  return module.default ?? module.config;
}

function assertConfigObject(
  config: unknown,
  absolutePath: string,
): asserts config is UnriftConfigOptions {
  if (!config || typeof config !== "object") {
    throw new Error(
      `Unrift config at ${absolutePath} must export an object (default export recommended).`,
    );
  }
}

function toAbsolutePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export async function loadConfigFromPath(
  configPath: string,
): Promise<LoadedConfig> {
  const absolutePath = toAbsolutePath(configPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const loaded = await importConfigFile(absolutePath);
  assertConfigObject(loaded, absolutePath);

  return {
    config: loaded,
    configPath: absolutePath,
    configDir: dirname(absolutePath),
  };
}

function findConfigPath(startDir: string): string | null {
  let dir = resolve(startDir);

  while (true) {
    let entries: string[] = [];
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

export async function loadConfig(
  startDir: string,
): Promise<LoadedConfig | null> {
  const found = findConfigPath(startDir);
  if (!found) return null;

  const absolutePath = toAbsolutePath(found);
  const loaded = await importConfigFile(absolutePath);

  assertConfigObject(loaded, absolutePath);

  return {
    config: loaded,
    configPath: absolutePath,
    configDir: dirname(absolutePath),
  };
}
