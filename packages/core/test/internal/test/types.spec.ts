import { it, expect } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Type checks an ESM and a CommonJS file that import the built package the
// way a project using node16 or nodenext resolution would. Relative imports
// in the published .d.ts files need their .js extension for that.
it("types resolve under nodenext", () => {
  const tsc = createRequire(resolve(process.cwd(), "package.json")).resolve(
    "typescript/bin/tsc",
  );
  const dir = resolve(process.cwd(), "test/types");
  const proc = spawnSync(
    process.execPath,
    [
      tsc,
      "--noEmit",
      "--strict",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--types",
      "node",
      resolve(dir, "esm.mts"),
      resolve(dir, "cjs.cts"),
    ],
    { encoding: "utf8" },
  );

  expect(proc.stdout + proc.stderr).toBe("");
  expect(proc.status).toBe(0);
}, 30000);
