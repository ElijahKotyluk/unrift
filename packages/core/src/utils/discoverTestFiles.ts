import { existsSync, readdirSync } from "fs";
import { join } from "path";

function isTestFileName(name: string): boolean {
  return /\.(spec|test)\.(ts|js)$/.test(name);
}

function discoverTestFiles(dir: string): string[] {
  console.log(`Discovering test files in: ${dir}`);
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    console.log(`Examining: ${entry.name}`);
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...discoverTestFiles(fullPath));

      continue;
    }

    console.log(`Checking if test file: ${isTestFileName(entry.name)}`);
    if (entry.isFile() && isTestFileName(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

export { discoverTestFiles, isTestFileName };
