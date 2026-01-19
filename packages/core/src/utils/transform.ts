import { buildSync } from "esbuild";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import { join, basename, extname, resolve, dirname, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const injectedFilename = fileURLToPath(import.meta.url);
const injectedDirname = dirname(injectedFilename);

function resolveInjectedGlobals() {
  return resolve(injectedDirname, "../injected/globals.js");
}

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function isTsLike(file: string): boolean {
  return (
    file.endsWith(".ts") ||
    file.endsWith(".tsx") ||
    file.endsWith(".mts") ||
    file.endsWith(".cts")
  );
}

// Find the nearest package.json upward from a file’s folder
function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);

  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return resolve(startDir);
    dir = parent;
  }
}

function readPackageName(projectRoot: string): string | null {
  try {
    const raw = readFileSync(join(projectRoot, "package.json"), "utf8");
    const json = JSON.parse(raw) as { name?: unknown };

    return typeof json.name === "string" ? json.name : null;
  } catch {
    return null;
  }
}

function tryProjectCacheRoot(projectRoot: string): string | null {
  const nodeModulesCache = projectNodeModulesCacheRoot(projectRoot);

  try {
    ensureDir(nodeModulesCache);
    return nodeModulesCache;
  } catch {
    return null;
  }
}

function getTmpCacheRoot(projectRoot: string): string {
  const projectKey = hashString(resolve(projectRoot));
  const tmpCache = join(os.tmpdir(), "unrift", projectKey);
  ensureDir(tmpCache);

  return tmpCache;
}

function pathExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// True if child is inside parent (after resolving symlinks when possible).
function isSubpath(child: string, parent: string): boolean {
  const parentReal = safeRealpath(parent);
  const childReal = safeRealpath(child);
  const p = parentReal.endsWith(sep) ? parentReal : parentReal + sep;

  return childReal === parentReal || childReal.startsWith(p);
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function projectNodeModulesCacheRoot(projectRoot: string) {
  return join(projectRoot, "node_modules", ".unrift", "cache");
}

function tempCacheRootForProject(projectRoot: string) {
  const projectKey = hashString(resolve(projectRoot));

  return getTmpCacheRoot(projectKey);
}

function rmDirIfExists(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });

    return true;
  } catch {
    // Don’t fail test runs because cleanup failed
    return false;
  }
}

export function cleanUnriftCaches(projectRoot: string): {
  projectCacheDir: string;
  tempCacheDir: string;
  projectCacheDeleted: boolean;
  tempCacheDeleted: boolean;
} {
  const projectCacheDir = projectNodeModulesCacheRoot(projectRoot);
  const tempCacheDir = tempCacheRootForProject(projectRoot);

  const projectCacheDeleted = rmDirIfExists(projectCacheDir);
  const tempCacheDeleted = rmDirIfExists(tempCacheDir);

  // also drop in-memory map so current process doesn’t think outputs exist
  cache.clear();

  return {
    projectCacheDir,
    tempCacheDir,
    projectCacheDeleted,
    tempCacheDeleted,
  };
}

type Mode = "bundle-config" | "bundle-test";
type CacheKey = string;

const cache = new Map<CacheKey, { hash: string; outUrl: string }>();

function cacheDirForMode(cacheRoot: string, mode: Mode) {
  return join(cacheRoot, mode === "bundle-config" ? "config" : "tests");
}

function cacheOutPath(cacheDir: string, filePath: string, h: string): string {
  const base = basename(filePath, extname(filePath));
  const pathHash = hashString(resolve(filePath));
  return join(cacheDir, `${base}.${pathHash}.${h}.mjs`);
}

/**
 * Create <cacheRoot>/node_modules/@unrift/core -> <projectRoot>
 * so cached bundles can resolve @unrift/core when self-hosting.
 */
function ensureSelfLink(cacheRoot: string, projectRoot: string) {
  // HARD SAFETY: never allow a self-link inside a cacheRoot that lives in the project
  if (isSubpath(cacheRoot, projectRoot)) {
    throw new Error(
      `Unrift internal: refusing to create self-host link because cacheRoot is inside projectRoot.\n` +
        `cacheRoot: ${cacheRoot}\nprojectRoot: ${projectRoot}\n` +
        `This would create a recursive directory cycle. Use temp cache for self-hosting.`,
    );
  }

  const nodeModules = join(cacheRoot, "node_modules");
  const scopeDir = join(nodeModules, "@unrift");
  const linkPath = join(scopeDir, "core");

  ensureDir(scopeDir);

  if (pathExists(linkPath)) return;

  const type =
    process.platform === "win32" ? ("junction" as const) : ("dir" as const);

  symlinkSync(projectRoot, linkPath, type);
}

function pickCacheRoot(projectRoot: string, selfHost: boolean): string {
  const fromEnv = process.env.UNRIFT_CACHE_DIR;

  if (fromEnv) {
    const envPath = resolve(fromEnv);

    // If self-hosting and env points inside project, ignore it to prevent cycles.
    if (selfHost && isSubpath(envPath, projectRoot)) {
      return getTmpCacheRoot(projectRoot);
    }

    return envPath;
  }

  // Normal users: prefer project-local cache
  const projectCache = tryProjectCacheRoot(projectRoot);

  // Self-host: need to avoid project-local cache if we need the self-link bridge
  if (selfHost) {
    return getTmpCacheRoot(projectRoot);
  }

  if (projectCache) return projectCache;
  return getTmpCacheRoot(projectRoot);
}

export function toImportUrl(
  filePath: string,
  mode: Mode = "bundle-test",
): string {
  if (!isTsLike(filePath)) return pathToFileURL(filePath).href;

  const source = readFileSync(filePath, "utf8");
  const hashStr = hashString(source);
  const key: CacheKey = `${mode}:${filePath}`;

  const existing = cache.get(key);

  if (existing && existing.hash === hashStr) return existing.outUrl;

  const projectRoot = findProjectRoot(dirname(filePath));
  const selfHost = readPackageName(projectRoot) === "@unrift/core";

  const cacheRoot = pickCacheRoot(projectRoot, selfHost);

  if (process.env.UNRIFT_DEBUG === "1") {
    console.log("[unrift] cacheRoot:", cacheRoot, "selfHost:", selfHost);
  }

  // Only create the self-link in safe cache roots (temp/env outside project)
  if (selfHost) {
    ensureSelfLink(cacheRoot, projectRoot);
  }

  const outDir = cacheDirForMode(cacheRoot, mode);
  ensureDir(outDir);

  const outFile = cacheOutPath(outDir, filePath, hashStr);

  buildSync({
    entryPoints: [filePath],
    outfile: outFile,

    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",

    packages: "external",
    external: ["@unrift/*", "@unrift/core", "@unrift/core/*"],

    absWorkingDir: projectRoot,

    inject: [resolveInjectedGlobals()],
    define: {
      __dirname: "injectedDirname",
      __filename: "injectedFilename",
      require: "injectedRequire",
    },

    sourcemap: "inline",
    sourcesContent: true,
    logLevel: "silent",
  });

  const outUrl = pathToFileURL(outFile).href;

  cache.set(key, { hash: hashStr, outUrl });

  return outUrl;
}
