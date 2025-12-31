import { existsSync, readdirSync } from "fs";
import { join } from "path";

function isTestFileName(name: string): boolean {
  return /\.(spec|test)\.(ts|js)$/.test(name);
}

function discoverTestFiles(dir: string): string[] {
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

export { discoverTestFiles, isTestFileName };
