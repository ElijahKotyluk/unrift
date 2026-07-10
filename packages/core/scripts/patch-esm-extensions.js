import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ESM_DIST = resolve(__dirname, "../dist/esm");

// Match relative specifiers starting with `./` OR `../`, so cross-directory
// imports like `../utils/helpers` also get a `.js` extension. `\.\.?\/` matches
// the leading `./` or `../`; `[^'"]+` then greedily grabs the rest (covering
// deeper `../../` paths too).
const importRegex = /(?<=import\s.+?from\s+['"])(\.\.?\/[^'"]+)(?=['"])/g;
const exportRegex = /(?<=export\s.+?from\s+['"])(\.\.?\/[^'"]+)(?=['"])/g;

// Recursively find all `.js` files in target directory.
async function findJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await findJsFiles(fullPath);

      files.push(...subFiles);
    } else if (entry.isFile() && fullPath.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

// Add `.js` extension to relative imports if missing.
async function patchFile(file) {
  let content = await readFile(file, "utf8");
  let changed = false;

  const patch = (match) => {
    if (extname(match)) return match;

    changed = true;

    return `${match}.js`;
  };

  content = content.replace(importRegex, patch);
  content = content.replace(exportRegex, patch);

  if (changed) {
    await writeFile(file, content, "utf8");
    console.log(`Patched: ${file}`);
  }
}

const files = await findJsFiles(ESM_DIST);

await Promise.all(files.map(patchFile));

console.log(`${files.length} files patched.`);
