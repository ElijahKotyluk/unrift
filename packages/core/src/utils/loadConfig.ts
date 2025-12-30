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

  const module = await import(toImportUrl(configPath, "bundle-config"))

  return module.default ?? module.config;
}

export async function loadConfigFromPath(
  configPath: string,
): Promise<UnriftConfigOptions> {
  const absolutePath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const config = await importConfigFile(absolutePath);

  if (!config || typeof config !== "object") {
    throw new Error(
      `Unrift config at ${absolutePath} must export an object (default export recommended).`,
    );
  }

  return config as UnriftConfigOptions;
}

function findConfigPath(startDir: string): string | null {
  let dir = startDir;

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
): Promise<UnriftConfigOptions | null> {
  const configPath = findConfigPath(startDir);

  if (!configPath) return null;

  const config = await importConfigFile(configPath);

  if (!config || typeof config !== "object") {
    throw new Error(
      `Unrift config at ${configPath} must export an object (default export recommended).`,
    );
  }

  return config as UnriftConfigOptions;
}
