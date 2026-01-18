import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { build } from "esbuild";

/**
 * Transforms and loads a test file (.ts/.tsx/.js/.jsx) in memory
 * using esbuild and dynamic import.
 */
export async function loadTestFile(filePath: string): Promise<void> {
  const absPath = resolve(filePath);
  const fileExt = extname(absPath);

  // Determine correct loader for esbuild
  const loader =
    fileExt === ".ts"
      ? "ts"
      : fileExt === ".tsx"
        ? "tsx"
        : fileExt === ".jsx"
          ? "jsx"
          : "js";

  // Read original source code
  const source = await readFile(absPath, "utf8");

  // Build using esbuild with in-memory output
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: dirname(absPath),
      sourcefile: absPath,
      loader,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    sourcemap: "inline",
    treeShaking: false,
    banner: {
      js: `
        import { createRequire } from 'module';
        import { dirname } from 'path';
        const __filename = ${JSON.stringify(absPath)};
        const __dirname = dirname(__filename);
        const require = createRequire(__filename);
      `,
    },
  });

  const jsCode = result.outputFiles?.[0]?.text;

  if (!jsCode) {
    throw new Error(`esbuild failed to transform: ${filePath}`);
  }

  // Load bundled code from a base64 data URL
  const base64 = Buffer.from(jsCode).toString("base64");
  const dataUrl = `data:text/javascript;base64,${base64}`;

  await import(dataUrl);
}
