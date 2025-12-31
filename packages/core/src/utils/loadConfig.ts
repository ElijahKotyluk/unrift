import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";

import type { UnriftConfigOptions } from "./defineConfig";
import { toImportUrl } from "./transform";

/**
 * Regex to match valid Unrift config file names.
 * Matches:
 * - unrift.config.ts/js/mjs/cjs/json
 * - unrift.<anything>.config.ts/js/mjs/cjs/json  (e.g. unrift.only.config.mjs)
 */
const CONFIG_RE = /^unrift(?:\.[^.]+)*\.config\.(ts|js|mjs|cjs|json)$/;

export type LoadedConfig = {
  config: UnriftConfigOptions;
  /** Absolute path to the config file on disk. */
  configPath: string;
  /** Absolute directory containing the config file (handy for rebasing paths). */
  configDir: string;
};

function isConfigFileName(name: string): boolean {
  return CONFIG_RE.test(name);
}

async function importConfigFile(configPath: string): Promise<unknown> {
  if (configPath.endsWith(".json")) {
    try {
      const raw = readFileSync(configPath, "utf8");
      return JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse JSON config at ${configPath}: ${msg}`);
    }
  }

  const mod = await import(toImportUrl(configPath, "bundle-config"));

  return mod.default ?? mod.config;
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
