import { describe, it, expect } from "@unrift/core";
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WORK = resolve(process.cwd(), "test/watch/.work");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function workspace(name: string, files: Record<string, string>) {
  const dir = join(WORK, name);

  rmSync(dir, { recursive: true, force: true });

  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  for (const [path, text] of Object.entries(files)) write(path, text);

  return { dir, write };
}

function watch(dir: string) {
  const child = spawn(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      join(dir, "unrift.config.ts"),
      "--watch",
    ],
    { env: { ...process.env, CI: "" } },
  );
  const out = { text: "" };

  child.stdout.on("data", (chunk) => (out.text += chunk));
  child.stderr.on("data", (chunk) => (out.text += chunk));

  const waitFor = async (check: () => boolean, ms = 5000) => {
    const start = Date.now();

    while (!check() && Date.now() - start < ms) await sleep(50);

    return check();
  };

  return {
    out,
    reruns: () => out.text.split("re-running").length - 1,
    waitFor,
    kill: () => child.kill(),
  };
}

describe("watch mode", () => {
  it("reruns when a file the tests or config import changes", async () => {
    const ws = workspace("imports", {
      "src/value.ts": `export const value = 1;\n`,
      "src/other.ts": `export const other = 1;\n`,
      "settings.ts": `export const bail = false;\n`,
      "unrift.config.ts": `import { bail } from "./settings";\nexport default { testDir: "test", bail };\n`,
      "test/a.spec.ts": `import { it, expect } from "@unrift/core";
import { value } from "../src/value";
it("value", () => expect(value).toBe(1));
`,
    });
    const value = join(ws.dir, "src/value.ts");
    const w = watch(ws.dir);

    try {
      expect(await w.waitFor(() => w.out.text.includes("for changes"))).toBe(
        true,
      );

      // An imported source file, outside the test dir
      writeFileSync(value, `export const value = 2;\n`);
      expect(await w.waitFor(() => w.out.text.includes("1 failed"))).toBe(true);
      expect(w.reruns()).toBe(1);

      // Saved the way many editors do: a new file renamed over the old one.
      // The edit after it still reruns, the new file is watched too.
      await sleep(300);
      writeFileSync(`${value}.tmp`, `export const value = 1;\n`);
      renameSync(`${value}.tmp`, value);
      expect(await w.waitFor(() => w.reruns() === 2)).toBe(true);
      await sleep(600);
      writeFileSync(value, `export const value = 3;\n`);
      expect(await w.waitFor(() => w.reruns() === 3)).toBe(true);

      // A file nothing imports
      await sleep(600);
      ws.write("src/other.ts", `export const other = 2;\n`);
      await sleep(600);
      expect(w.reruns()).toBe(3);

      // A file the config imports
      ws.write("settings.ts", `export const bail = true;\n`);
      expect(await w.waitFor(() => w.reruns() === 4)).toBe(true);
    } finally {
      w.kill();
    }
  }, 15000);

  it("keeps watching through broken files and a moved test dir", async () => {
    // Starts with a syntax error in an import that never built
    const ws = workspace("recover", {
      "src/value.ts": `export const value = ;\n`,
      "settings.ts": `export const testDir = "test";\n`,
      "unrift.config.ts": `import { testDir } from "./settings";\nexport default { testDir };\n`,
      "test/a.spec.ts": `import { it, expect } from "@unrift/core";
import { value } from "../src/value";
it("value", () => expect(value).toBe(1));
`,
    });
    const w = watch(ws.dir);

    try {
      expect(await w.waitFor(() => w.out.text.includes("for changes"))).toBe(
        true,
      );

      // Fixing it reruns
      ws.write("src/value.ts", `export const value = 1;\n`);
      expect(await w.waitFor(() => w.out.text.includes("1 passed"))).toBe(true);

      // A config that doesn't load fails the run, watch mode stays up
      await sleep(300);
      ws.write("settings.ts", `export const testDir = ;\n`);
      expect(await w.waitFor(() => w.reruns() === 2)).toBe(true);
      await sleep(600);
      mkdirSync(join(ws.dir, "moved"));
      ws.write("settings.ts", `export const testDir = "moved";\n`);
      expect(await w.waitFor(() => w.reruns() === 3)).toBe(true);

      // The config moved the test dir, a test made there reruns
      await sleep(600);
      ws.write(
        "moved/b.spec.ts",
        `import { it } from "@unrift/core";\nit("b", () => {});\n`,
      );
      expect(await w.waitFor(() => w.reruns() === 4)).toBe(true);
    } finally {
      w.kill();
    }
  }, 15000);
});
