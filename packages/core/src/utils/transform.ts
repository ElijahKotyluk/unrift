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
  writeFileSync,
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

function pathExists(path: string): boolean {
  try {
    lstatSync(path);

    return true;
  } catch {
    return false;
  }
}

// True if child is inside parent (after resolving symlinks when possible).
export function isSubpath(child: string, parent: string): boolean {
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

  return join(os.tmpdir(), "unrift", projectKey);
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

  // Clear in-memory cache
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

type CacheEntry = {
  outUrl: string;
  // Every file esbuild read for the bundle and its hash. The test file
  // alone isn't enough: an edit to a file it imports has to rebuild too.
  inputs: Array<{ path: string; hash: string }>;
};

const cache = new Map<CacheKey, CacheEntry>();

// Files a failed build's errors point at. Watch mode watches them too, so
// fixing a broken import reruns even if the bundle never built.
const failedInputs = new Map<CacheKey, string[]>();

// The run each entry was last used in. Watch mode only watches what the
// latest run used, an entry for a deleted test stays in the cache unused.
let generation = 0;
const usedIn = new Map<CacheKey, number>();

/** Starts a new run for `bundledFiles`. */
export function startBundleRun(): void {
  generation++;
}

function hashFile(path: string): string | null {
  try {
    return hashString(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function inputsUnchanged(entry: CacheEntry): boolean {
  return entry.inputs.every(({ path, hash }) => hashFile(path) === hash);
}

/**
 * Every file read for a bundle this run: test files, the config and what
 * they import. `failed` is true when a build failed, its imports are unknown.
 */
export function bundledFiles(): { files: string[]; failed: boolean } {
  const files = new Set<string>();
  let failed = false;

  for (const [key, run] of usedIn) {
    if (run !== generation) continue;

    // A bundle that broke keeps what it read the last time it built
    for (const { path } of cache.get(key)?.inputs ?? []) files.add(path);

    const broken = failedInputs.get(key);

    if (broken) {
      failed = true;
      for (const path of broken) files.add(path);
    }
  }

  return { files: [...files], failed };
}

function cacheDirForMode(cacheRoot: string, mode: Mode) {
  return join(cacheRoot, mode === "bundle-config" ? "config" : "tests");
}

function cacheOutPath(
  cacheDir: string,
  filePath: string,
  h: string,
  coverage: boolean,
): string {
  const base = basename(filePath, extname(filePath));
  const pathHash = hashString(resolve(filePath));
  return join(
    cacheDir,
    `${base}.${pathHash}.${h}${coverage ? ".cov" : ""}.mjs`,
  );
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

export type TransformOptions = {
  /** Keep code no test uses, so it shows up as uncovered. */
  coverage?: boolean;
};

export function toImportUrl(
  filePath: string,
  mode: Mode = "bundle-test",
  options: TransformOptions = {},
): string {
  if (!isTsLike(filePath)) return pathToFileURL(filePath).href;

  const coverage = options.coverage ?? false;
  const key: CacheKey = `${mode}:${coverage ? "cov" : ""}:${filePath}`;

  usedIn.set(key, generation);

  const existing = cache.get(key);

  if (existing && inputsUnchanged(existing)) return existing.outUrl;

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

  // Node reports the bundle by its real path (macOS /var is a symlink), so
  // write it there and the source map's relative paths resolve from it.
  const realOutDir = safeRealpath(outDir);

  let inputs: CacheEntry["inputs"];
  let outFile: string;

  try {
    const result = buildSync({
      entryPoints: [filePath],
      // Only sets where the source map's paths are relative to, the real
      // name needs the inputs
      outfile: join(realOutDir, "bundle.mjs"),
      write: false,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
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
      // An export no test imports would be dropped and never count as uncovered
      treeShaking: !coverage,
      metafile: true,
      logLevel: "silent",
    });

    // Inputs that aren't files on disk (esbuild's own) can't change
    inputs = Object.keys(result.metafile.inputs).flatMap((input) => {
      const path = resolve(projectRoot, input);
      const hash = hashFile(path);

      return hash === null ? [] : [{ path, hash }];
    });

    // Named after every input, not just the entry. Node caches a module by
    // its URL, so a config rebuilt for an edited import needs a new one.
    outFile = cacheOutPath(
      realOutDir,
      filePath,
      hashString(inputs.map((i) => `${i.path}\0${i.hash}`).join("\n")),
      coverage,
    );
    writeFileSync(outFile, result.outputFiles[0].contents);
  } catch (err) {
    const errors = (err as { errors?: Array<{ location?: { file: string } }> })
      .errors;

    failedInputs.set(key, [
      filePath,
      ...(errors ?? []).flatMap((e) =>
        e.location ? [resolve(projectRoot, e.location.file)] : [],
      ),
    ]);

    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes("Cannot find module") ||
      msg.includes("MODULE_NOT_FOUND")
    ) {
      throw new Error(
        `esbuild is required but could not be loaded. Run: npm install esbuild\n\nOriginal error: ${msg}`,
      );
    }

    throw err;
  }

  const outUrl = pathToFileURL(outFile).href;

  cache.set(key, { outUrl, inputs });
  failedInputs.delete(key);

  return outUrl;
}
