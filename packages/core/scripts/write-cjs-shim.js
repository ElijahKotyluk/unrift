import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CJS_DIST = resolve(__dirname, "../dist/cjs");

const outputPath = resolve(CJS_DIST, "index.cjs");

const shim = `'use strict';

let esm;

function load() {
  if (!esm) {
    esm = require('node:module')
      .createRequire(__filename)('../esm/index.js');
  }
  return esm;
}

module.exports = new Proxy({}, {
  get(_t, p) {
    return load()[p];
  },
  has(_t, p) {
    return p in load();
  },
  ownKeys() {
    return Reflect.ownKeys(load());
  },
  getOwnPropertyDescriptor(_t, p) {
    return {
      configurable: true,
      enumerable: true,
      writable: false,
      value: load()[p],
    };
  }
});
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, shim);

console.log("✅ CJS shim written to", outputPath);
