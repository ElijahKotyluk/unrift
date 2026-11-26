import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CJS_DIST = resolve(__dirname, "../dist/cjs");

const outputPath = resolve(CJS_DIST, "index.cjs");

// Node 22.12+ can require() an ES module, so the CommonJS entry is a plain
// require of the ESM build. No node:module or Proxy, which supply chain
// scanners flag as debug access.
const shim = `'use strict';

module.exports = require('../esm/index.js');
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, shim);

console.log("✅ CJS shim written to", outputPath);
