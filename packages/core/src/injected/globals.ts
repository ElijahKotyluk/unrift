import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

export const injectedDirname = path.dirname(fileURLToPath(import.meta.url));
export const injectedFilename = fileURLToPath(import.meta.url);
export const injectedRequire = createRequire(import.meta.url);
