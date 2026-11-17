import { describe, it, expect } from "@unrift/core";
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WORK = resolve(process.cwd(), "test/watch/.work");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("watch mode", () => {
  it("reruns when a file the tests or config import changes", async () => {
    const dir = join(WORK, "imports");

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "test"), { recursive: true });

    const value = join(dir, "src/value.ts");

    writeFileSync(value, `export const value = 1;\n`);
    writeFileSync(join(dir, "src/other.ts"), `export const other = 1;\n`);
    writeFileSync(join(dir, "settings.ts"), `export const bail = false;\n`);
    writeFileSync(
      join(dir, "unrift.config.ts"),
      `import { bail } from "./settings";\nexport default { testDir: "test", bail };\n`,
    );
    writeFileSync(
      join(dir, "test/a.spec.ts"),
      `import { it, expect } from "@unrift/core";
import { value } from "../src/value";
it("value", () => expect(value).toBe(1));
`,
    );

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
    let output = "";

    child.stdout.on("data", (chunk) => (output += chunk));

    const reruns = () => output.split("re-running").length - 1;
    const waitFor = async (check: () => boolean, ms = 5000) => {
      const start = Date.now();

      while (!check() && Date.now() - start < ms) await sleep(50);

      return check();
    };

    try {
      expect(await waitFor(() => output.includes("for changes"))).toBe(true);

      // An imported source file, outside the test dir
      writeFileSync(value, `export const value = 2;\n`);
      expect(await waitFor(() => output.includes("1 failed"))).toBe(true);
      expect(reruns()).toBe(1);

      // Saved the way many editors do: a new file renamed over the old one.
      // The edit after it still reruns, the new file is watched too.
      await sleep(300);
      writeFileSync(`${value}.tmp`, `export const value = 1;\n`);
      renameSync(`${value}.tmp`, value);
      expect(await waitFor(() => reruns() === 2)).toBe(true);
      await sleep(600);
      writeFileSync(value, `export const value = 3;\n`);
      expect(await waitFor(() => reruns() === 3)).toBe(true);

      // A file nothing imports
      await sleep(600);
      writeFileSync(join(dir, "src/other.ts"), `export const other = 2;\n`);
      await sleep(600);
      expect(reruns()).toBe(3);

      // A file the config imports
      writeFileSync(join(dir, "settings.ts"), `export const bail = true;\n`);
      expect(await waitFor(() => reruns() === 4)).toBe(true);
    } finally {
      child.kill();
    }
  }, 15000);
});
