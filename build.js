const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const packages = [
  "core",
];

for (const pkg of packages) {
  const srcDir = path.join(__dirname, `packages/${pkg}/src`);
  const distDir = path.join(__dirname, `packages/${pkg}/dist`);
  // Find all .ts entry points (excluding test files)
  const entryPoints = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => path.join(srcDir, f));

  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  esbuild.buildSync({
    entryPoints,
    outdir: distDir,
    // outfile: path.join(distDir, 'index.js'),
    bundle: true,
    format: "esm",
    platform: "node",
    sourcemap: true,
    target: ["node24"],
    tsconfig: path.join(__dirname, `packages/${pkg}/tsconfig.build.json`),
    external: ["tsconfig.json"], // Add external dependencies if needed
  });
}
