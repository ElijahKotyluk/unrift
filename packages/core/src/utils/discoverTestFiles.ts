import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function isTestFileName(name: string): boolean {
  return /\.(spec|test)\.(ts|js)$/.test(name);
}

export function discoverTestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

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
