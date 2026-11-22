import { describe, it, expect } from "@unrift/core";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function watch(dir: string, ...args: string[]) {
  return watchWith({}, dir, ...args);
}

function watchWith(
  env: Record<string, string>,
  dir: string,
  ...args: string[]
) {
  const child = spawn(
    process.execPath,
    [
      resolve(process.cwd(), "bin/unrift.mjs"),
      "--config",
      join(dir, "unrift.config.ts"),
      "--watch",
      ...args,
    ],
    { env: { ...process.env, CI: "", ...env } },
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
      "src/only-b.ts": `export const b = 1;\n`,
      "settings.ts": `export const bail = false;\n`,
      "unrift.config.ts": `import { bail } from "./settings";\nexport default { testDir: "test", bail };\n`,
      "test/a.spec.ts": `import { it, expect } from "@unrift/core";
import { value } from "../src/value";
it("value", () => expect(value).toBe(1));
`,
      "test/b.spec.ts": `import { it } from "@unrift/core";
import { b } from "../src/only-b";
it("b", () => void b);
`,
    });
    const value = join(ws.dir, "src/value.ts");
    // The workers bundle the tests, they tell the main thread what to watch
    const w = watch(ws.dir, "--workers", "2");

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

      // Broken, then put back as it was. That's a cache hit, the failure
      // must still be over: nothing else reruns after it (below).
      await sleep(600);
      writeFileSync(value, `export const value = ;\n`);
      expect(await w.waitFor(() => w.reruns() === 4)).toBe(true);
      await sleep(600);
      writeFileSync(value, `export const value = 3;\n`);
      expect(await w.waitFor(() => w.reruns() === 5)).toBe(true);

      // A deleted test's imports aren't watched anymore, nor is a file
      // nothing imports
      await sleep(600);
      rmSync(join(ws.dir, "test/b.spec.ts"));
      expect(await w.waitFor(() => w.reruns() === 6)).toBe(true);
      await sleep(600);
      ws.write("src/only-b.ts", `export const b = 2;\n`);
      ws.write("src/other.ts", `export const other = 2;\n`);
      await sleep(600);
      expect(w.reruns()).toBe(6);

      // The folder deleted and made again: its files are still watched
      rmSync(join(ws.dir, "src"), { recursive: true });
      ws.write("src/value.ts", `export const value = 1;\n`);
      expect(await w.waitFor(() => w.reruns() === 7)).toBe(true);
      await sleep(600);
      writeFileSync(value, `export const value = 4;\n`);
      expect(await w.waitFor(() => w.reruns() === 8)).toBe(true);

      // A file the config imports
      await sleep(600);
      ws.write("settings.ts", `export const bail = true;\n`);
      expect(await w.waitFor(() => w.reruns() === 9)).toBe(true);
    } finally {
      w.kill();
    }
  }, 25000);

  it("keeps watching through broken files and a moved test dir", async () => {
    // Starts with an import that never built. esbuild puts the error on the
    // test file, not on value.ts.
    const ws = workspace("recover", {
      "src/value.ts": `export const other = 1;\n`,
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
      expect(w.reruns()).toBe(1);

      // A config that doesn't load fails the run, watch mode stays up
      await sleep(600);
      ws.write("settings.ts", `export const testDir = ;\n`);
      expect(await w.waitFor(() => w.reruns() === 2)).toBe(true);

      // Moved to a test dir that doesn't exist yet
      await sleep(600);
      ws.write("settings.ts", `export const testDir = "moved";\n`);
      expect(await w.waitFor(() => w.reruns() === 3)).toBe(true);

      // Making it with a test in it reruns
      await sleep(600);
      ws.write(
        "moved/b.spec.ts",
        `import { it } from "@unrift/core";\nit("b", () => {});\n`,
      );
      expect(await w.waitFor(() => w.reruns() === 4)).toBe(true);

      // The config deleted, then put back
      const config = join(ws.dir, "unrift.config.ts");
      const text = readFileSync(config, "utf8");

      await sleep(600);
      rmSync(config);
      expect(await w.waitFor(() => w.reruns() === 5)).toBe(true);
      await sleep(600);
      writeFileSync(config, text);
      expect(await w.waitFor(() => w.reruns() === 6)).toBe(true);
    } finally {
      w.kill();
    }
  }, 25000);

  it("reruns for a change saved during a run", async () => {
    const ws = workspace("during", {
      "unrift.config.ts": `export default { testDir: "test" };\n`,
      "test/slow.spec.ts": `import { it } from "@unrift/core";
it("slow", () => new Promise((r) => setTimeout(r, 1000)));
`,
      "test/gone.spec.ts": `import { it } from "@unrift/core";\nit("gone", () => {});\n`,
    });
    const spec = join(ws.dir, "test/slow.spec.ts");
    const w = watch(ws.dir);

    try {
      expect(await w.waitFor(() => w.out.text.includes("for changes"))).toBe(
        true,
      );

      writeFileSync(spec, readFileSync(spec, "utf8") + "\n");
      expect(await w.waitFor(() => w.reruns() === 1)).toBe(true);
      // The run takes a second, this lands during it
      await sleep(300);
      writeFileSync(spec, readFileSync(spec, "utf8") + "\n");
      expect(await w.waitFor(() => w.reruns() === 2)).toBe(true);

      // A delete keeps no time to compare, it's a change too
      await w.waitFor(() => w.out.text.split("for changes").length === 3);
      writeFileSync(spec, readFileSync(spec, "utf8") + "\n");
      expect(await w.waitFor(() => w.reruns() === 3)).toBe(true);
      await sleep(300);
      rmSync(join(ws.dir, "test/gone.spec.ts"));
      expect(await w.waitFor(() => w.reruns() === 4)).toBe(true);
    } finally {
      w.kill();
    }
  }, 15000);

  it("runs the edited code of a plain JS import and the matchers module", async () => {
    const ws = workspace("fresh", {
      "unrift.config.ts": `export default { testDir: "test", matchers: ["./setup.mjs"] };\n`,
      "setup.mjs": `import { beforeAll } from "@unrift/core";\nbeforeAll(() => console.log("setup one"));\n`,
      "test/helper.js": `import { expect } from "@unrift/core";\nexport function check() {\n  expect(1).toMatchInlineSnapshot();\n}\n`,
      "test/a.spec.js": `import { it } from "@unrift/core";\nimport { check } from "./helper.js";\nit("a", () => check());\n`,
    });
    const helper = join(ws.dir, "test/helper.js");
    const w = watch(ws.dir);

    try {
      expect(await w.waitFor(() => w.out.text.includes("for changes"))).toBe(
        true,
      );

      // Node cached the first one, its offsets would land in the new code
      ws.write(
        "test/helper.js",
        `import { expect } from "@unrift/core";\nexport function check() {\n  expect(7).toMatchInlineSnapshot();\n  expect(5).toMatchInlineSnapshot();\n}\n`,
      );
      expect(await w.waitFor(() => w.out.text.includes("2 written"))).toBe(
        true,
      );
      expect(readFileSync(helper, "utf8")).toContain(
        "expect(7).toMatchInlineSnapshot(`7`);\n  expect(5).toMatchInlineSnapshot(`5`);",
      );

      // Outside the test dir, and loaded by Node
      ws.write(
        "setup.mjs",
        `import { beforeAll } from "@unrift/core";\nbeforeAll(() => console.log("setup two"));\n`,
      );
      expect(await w.waitFor(() => w.out.text.includes("setup two"))).toBe(
        true,
      );
    } finally {
      w.kill();
    }
  }, 15000);

  it("doesn't rerun for a snapshot a worker writes during the run", async () => {
    const ws = workspace("worker-snap", {
      "unrift.config.ts": `export default { testDir: "test" };\n`,
      "test/a.spec.ts": `import { it, expect } from "@unrift/core";\nit("a", () => expect(1).toMatchSnapshot());\n`,
      // Keeps the run going once a's worker wrote its .snap
      "test/b.spec.ts": `import { it } from "@unrift/core";\nit("b", () => new Promise((r) => setTimeout(r, 1000)));\n`,
    });
    const w = watch(ws.dir, "--workers", "2");

    try {
      expect(await w.waitFor(() => w.out.text.includes("for changes"))).toBe(
        true,
      );

      ws.write(
        "test/a.spec.ts",
        `import { it, expect } from "@unrift/core";\nit("a", () => { expect(1).toMatchSnapshot(); expect(2).toMatchSnapshot(); });\n`,
      );
      expect(
        await w.waitFor(() => w.out.text.split("written").length === 3),
      ).toBe(true);
      await sleep(1000);
      expect(w.reruns()).toBe(1);

      // An edit to it after the worker wrote it, while the run goes on, is
      // the user's
      const snap = join(ws.dir, "test/__snapshots__/a.spec.ts.snap");

      ws.write(
        "test/a.spec.ts",
        `import { it, expect } from "@unrift/core";\nit("a", () => { expect(1).toMatchSnapshot(); expect(2).toMatchSnapshot(); expect(3).toMatchSnapshot(); });\n`,
      );
      expect(
        await w.waitFor(() => readFileSync(snap, "utf8").includes("a 3")),
      ).toBe(true);
      writeFileSync(snap, readFileSync(snap, "utf8").replace("`3`", "`4`"));
      expect(await w.waitFor(() => w.reruns() === 3)).toBe(true);
    } finally {
      w.kill();
    }
  }, 15000);

  it("says it's watching once the watchers are set up", async () => {
    const ws = workspace("ready", {
      "unrift.config.ts": `export default { testDir: "test" };\n`,
      "test/a.spec.ts": `import { it } from "@unrift/core";\nit("a", () => {});\n`,
    });
    const w = watchWith({ UNRIFT_DEBUG: "1" }, ws.dir);

    try {
      expect(await w.waitFor(() => w.out.text.includes("for changes"))).toBe(
        true,
      );

      const text = w.out.text;

      expect(
        text.indexOf(`[unrift] watching ${join(ws.dir, "test")}`),
      ).toBeLessThan(text.indexOf("for changes"));
    } finally {
      w.kill();
    }
  });

  it("reloads an edited config Node runs without bundling", () => {
    // Watch mode loads the config again on every run
    const ws = workspace("native-config", {
      "unrift.config.mjs": `export default { testDir: "a" };\n`,
      "unrift.config.cjs": `module.exports = { testDir: "a" };\n`,
    });
    const script = join(ws.dir, "load.mjs");

    writeFileSync(
      script,
      `import { loadConfigFromPath } from ${JSON.stringify(pathToFileURL(resolve(process.cwd(), "dist/esm/utils/loadConfig.js")).href)};
import { readFileSync, writeFileSync } from "node:fs";
const out = [];
for (const name of ["unrift.config.mjs", "unrift.config.cjs"]) {
  const path = ${JSON.stringify(ws.dir)} + "/" + name;
  out.push((await loadConfigFromPath(path)).config.testDir);
  writeFileSync(path, readFileSync(path, "utf8").replace('"a"', '"b"'));
  out.push((await loadConfigFromPath(path)).config.testDir);
}
console.log(JSON.stringify(out));
`,
    );

    const res = spawnSync(process.execPath, [script], { encoding: "utf8" });

    expect(JSON.parse(res.stdout)).toEqual(["a", "b", "a", "b"]);
  });
});
