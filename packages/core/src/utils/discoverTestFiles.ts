import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function isTestFileName(name: string): boolean {
  return /\.(spec|test)\.(ts|js|mts|cts|tsx|jsx|mjs|cjs)$/.test(name);
}

export function discoverTestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      try {
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...discoverTestFiles(fullPath));
        } else if (stat.isFile() && isTestFileName(entry.name)) {
          files.push(fullPath);
        }
      } catch {
        // Broken symlink — skip silently
      }

      continue;
    }

    if (entry.isDirectory()) {
      files.push(...discoverTestFiles(fullPath));

      continue;
    }

    if (entry.isFile() && isTestFileName(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}
