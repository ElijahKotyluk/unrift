import { init as initCjsLexer, parse as parseCjs } from "cjs-module-lexer";
import { build, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, extname, isAbsolute, resolve } from "node:path";

import { scanSource, type MockCall } from "../mock/hoist.js";
import { MODULE_MOCKS_GLOBAL_KEY } from "../mock/module.js";

const NAMESPACE = "unrift-mock";
export const PRELUDE = "unrift-mock-prelude";

// An import from these gives the hoisted factories `mock` and the rest.
// Matched where the scanner found an `import`, comments allowed inside.
const UNRIFT_IMPORT =
  /import((?:[\w$*{},\s]|\/\*[\s\S]*?\*\/|\/\/[^\n]*)+?)from\s*(["'])(unrift|@unrift\/core)\2/y;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

type Target = {
  key: string;
  spec: string;
  /** Resolved file, or null for a package or built-in */
  path: string | null;
};

const isBare = (spec: string) => !spec.startsWith(".") && !isAbsolute(spec);

function loaderFor(file: string) {
  const ext = extname(file);

  if (ext === ".tsx" || ext === ".jsx") return "tsx" as const;

  return "ts" as const;
}

/**
 * The calls to bundle around, or none when the test file doesn't use
 * `mock.module`.
 */
export function moduleMockCalls(
  source: string,
  file: string,
): { calls: MockCall[]; imports: number[] } {
  const none = { calls: [], imports: [] };

  if (!source.includes("mock")) return none;

  const scan = scanSource(source, loaderFor(file) === "tsx");

  return scan.calls.some((c) => c.kind === "module") ? scan : none;
}

/**
 * Bundles a test file that calls `mock.module`:
 *
 * - A prelude, imported first, sets up an entry per mocked module and runs
 *   the top-level `mock.module` calls, so they run before the file's imports.
 * - Every import of a mocked module, from any file in the bundle, gets a
 *   stand-in module whose exports point at the mock or the real module.
 *   The real one only loads when it isn't mocked.
 */
export function moduleMockPlugin(
  testFile: string,
  source: string,
  { calls, imports: importStarts }: { calls: MockCall[]; imports: number[] },
  injected: string,
): Plugin {
  const fileKey = createHash("sha256")
    .update(testFile)
    .digest("hex")
    .slice(0, 8);

  return {
    name: "unrift-module-mock",
    setup(b) {
      let targets: Promise<Map<string, Target>> | undefined;
      const preludes = new Map<string, string>();

      // spec -> target, specs resolved from the test file
      const resolveTargets = () =>
        (targets ??= (async () => {
          const map = new Map<string, Target>();

          for (const call of calls) {
            if (call.kind !== "module" || map.has(call.spec)) continue;

            if (isBare(call.spec)) {
              map.set(call.spec, {
                key: `${fileKey}:${call.spec}`,
                spec: call.spec,
                path: null,
              });
              continue;
            }

            const r = await b.resolve(call.spec, {
              kind: "import-statement",
              resolveDir: dirname(testFile),
              importer: testFile,
              pluginData: { unriftSkip: true },
            });

            if (r.errors.length > 0) {
              throw new Error(
                `mock.module("${call.spec}"): can't find the module from ${testFile}`,
              );
            }

            map.set(call.spec, {
              key: `${fileKey}:${r.path}`,
              spec: call.spec,
              path: r.path,
            });
          }

          return map;
        })());

      // Targets by resolved file, or by specifier for a package
      let byPathMap: Promise<Map<string, Target>> | undefined;
      const byPath = () =>
        (byPathMap ??= resolveTargets().then(
          (specs) =>
            new Map([...specs.values()].map((t) => [t.path ?? t.spec, t])),
        ));

      b.onLoad(
        {
          filter: new RegExp(`^${escapeRegExp(testFile)}$`),
          namespace: "file",
        },
        async () => {
          const specs = await resolveTargets();
          const hoisted = calls.filter(
            (c) => c.kind === "module" && c.topLevel,
          );
          let out = "";
          let at = 0;

          // Point each call at its entry, and take the hoisted ones out,
          // keeping lines where they were for the source map
          for (const call of calls) {
            // Inside a hoisted call, it moved with it
            if (call.start < at) continue;

            const target = specs.get(call.spec);

            if (call.kind === "module" && call.topLevel) {
              out += source.slice(at, call.start);
              out += source.slice(call.start, call.end).replace(/[^\n]/g, " ");
              at = call.end;
            } else if (target) {
              out += source.slice(at, call.specStart);
              out += JSON.stringify(target.key);
              at = call.specEnd;
            }
          }

          out += source.slice(at);

          // The hoisted call's text, it and the calls inside it keyed
          const keyed = (outer: MockCall) => {
            let text = "";
            let from = outer.start;

            for (const call of calls) {
              const target = specs.get(call.spec);

              if (call.start < outer.start || call.end > outer.end) continue;
              if (!target || call.specStart < from) continue;

              text += source.slice(from, call.specStart);
              text += JSON.stringify(target.key);
              from = call.specEnd;
            }

            return text + source.slice(from, outer.end);
          };

          const imports = importStarts.flatMap((at) => {
            UNRIFT_IMPORT.lastIndex = at;
            const m = UNRIFT_IMPORT.exec(source);
            const clause = m?.[1].replace(COMMENT, " ").trim();

            if (!m || !clause || /^type\b/.test(clause)) return [];

            return [`import ${clause} from ${JSON.stringify(m[3])};`];
          });
          const entries = [...specs.values()].map(
            (t) =>
              `__mocks.set(${JSON.stringify(t.key)}, { spec: ${JSON.stringify(t.spec)}, mocked: false, ` +
              `loadReal: () => import(${JSON.stringify(t.path ?? t.spec)}) });`,
          );
          const prelude = [
            ...imports,
            `const __mocks = (globalThis[${JSON.stringify(MODULE_MOCKS_GLOBAL_KEY)}] ??= new Map());`,
            ...entries,
            ...hoisted.map((c) => {
              const text = keyed(c).trim().replace(/;$/, "");

              return text.startsWith("await") ? `${text};` : `await (${text});`;
            }),
          ].join("\n");

          preludes.set(testFile, prelude);

          return {
            // On the first line, the rest keep their numbers
            contents: `import ${JSON.stringify(`${PRELUDE}:${testFile}`)};${out}`,
            loader: loaderFor(testFile),
            resolveDir: dirname(testFile),
          };
        },
      );

      b.onResolve({ filter: new RegExp(`^${PRELUDE}:`) }, (args) => ({
        path: args.path.slice(PRELUDE.length + 1),
        namespace: PRELUDE,
      }));

      b.onLoad({ filter: /.*/, namespace: PRELUDE }, (args) => ({
        contents: preludes.get(args.path) ?? "",
        loader: loaderFor(args.path),
        resolveDir: dirname(args.path),
        pluginData: { unriftSkip: true },
      }));

      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.unriftSkip || args.kind === "entry-point") return;
        // Unrift's own injected file, it isn't the code under test
        if (args.importer === injected) return;
        // Stand-ins load with an `await`, which `require` can't wait for
        if (args.kind === "require-call" || args.kind === "require-resolve")
          return;

        const targetsByPath = await byPath();

        if (isBare(args.path)) {
          const t = targetsByPath.get(args.path);

          if (t && !t.path) {
            return { path: t.key, namespace: NAMESPACE, pluginData: t };
          }
        }

        const r = await b.resolve(args.path, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          importer: args.importer,
          pluginData: { unriftSkip: true },
        });

        // A path alias can resolve to a mocked file
        const t =
          r.errors.length === 0 && !r.external
            ? targetsByPath.get(r.path)
            : undefined;

        if (t) return { path: t.key, namespace: NAMESPACE, pluginData: t };

        return undefined;
      });

      b.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => {
        const t = args.pluginData as Target;
        const names = await exportNames(t, testFile);
        const locals = names.map((_, i) => `__e${i}`);

        return {
          contents: [
            `const __entry = globalThis[${JSON.stringify(MODULE_MOCKS_GLOBAL_KEY)}].get(${JSON.stringify(t.key)});`,
            locals.length > 0 ? `let ${locals.join(", ")};` : "",
            locals.length > 0
              ? `export { ${names.map((name, i) => `${locals[i]} as ${JSON.stringify(name)}`).join(", ")} };`
              : "export {};",
            `__entry.bind = (m) => { ${names.map((name, i) => `${locals[i]} = m[${JSON.stringify(name)}];`).join(" ")} };`,
            `__entry.bind(__entry.mocked ? __entry.exports : await __entry.loadReal());`,
          ].join("\n"),
          loader: "js",
          resolveDir: dirname(testFile),
          pluginData: { unriftSkip: true },
        };
      });
    },
  };
}

/**
 * What the real module exports, so the stand-in can export the same. Read
 * from the source, the module doesn't run.
 */
async function exportNames(t: Target, testFile: string): Promise<string[]> {
  try {
    if (!t.path && isBuiltin(t.spec)) return namesOf(await import(t.spec));

    // A package resolves the way the stand-in's import() will
    const file = t.path ?? (await resolveImport(t.spec, dirname(testFile)));

    if (!file) throw new Error("can't find the module");

    const seen = new Set<string>();

    return (
      (await esmExportNames(file, seen)) ?? (await cjsExportNames(file, seen))
    );
  } catch (err) {
    throw new Error(
      `mock.module("${t.spec}"): can't read the module's exports: ${(err as Error).message}`,
    );
  }
}

/** An ES module's export names, or null for CommonJS. */
async function esmExportNames(
  file: string,
  seen: Set<string>,
): Promise<string[] | null> {
  const result = await build({
    entryPoints: [file],
    bundle: false,
    write: false,
    metafile: true,
    format: "esm",
    platform: "node",
    target: "node22",
    absWorkingDir: dirname(file),
    logLevel: "silent",
  });
  const input = Object.entries(result.metafile.inputs).find(
    ([path]) => resolve(dirname(file), path) === file,
  );

  if (input?.[1].format === "cjs") return null;

  const names = new Set(Object.values(result.metafile.outputs)[0]?.exports);

  seen.add(file);

  // esbuild leaves `export * from` as is, follow it
  for (const [, spec] of result.outputFiles[0].text.matchAll(STAR_EXPORT)) {
    const from = JSON.parse(spec) as string;

    for (const name of await starNames(from, file, seen, "import")) {
      names.add(name);
    }
  }

  return [...names];
}

/**
 * A CommonJS module's export names, found the way Node finds them for an
 * import of it, with the lexer Node uses.
 */
async function cjsExportNames(
  file: string,
  seen: Set<string>,
): Promise<string[]> {
  await initCjsLexer();
  seen.add(file);

  const { exports, reexports } = parseCjs(readFileSync(file, "utf8"));
  const names = new Set(["default", ...exports]);

  // `module.exports = require("./other")` and the like
  for (const from of reexports) {
    for (const name of await starNames(from, file, seen, "require")) {
      names.add(name);
    }
  }

  names.delete("__esModule");

  return [...names];
}

/** The names `from` adds to `file` when `file` re-exports all of it. */
async function starNames(
  from: string,
  file: string,
  seen: Set<string>,
  kind: "import" | "require",
): Promise<string[]> {
  if (isBuiltin(from)) {
    return namesOf(await import(from)).filter((n) => n !== "default");
  }

  let target: string | null;

  try {
    target =
      kind === "import"
        ? await resolveImport(from, dirname(file))
        : createRequire(file).resolve(from);
  } catch {
    target = null;
  }

  if (!target) throw new Error(`can't find "${from}" from ${file}`);
  if (seen.has(target)) return [];

  const names =
    (await esmExportNames(target, seen)) ??
    (await cjsExportNames(target, seen));

  return names.filter((n) => n !== "default");
}

const STAR_EXPORT = /^export \* from ("[^"\n]*");$/gm;

/** Resolves `spec` from `resolveDir` with Node's import conditions. */
export async function resolveImport(
  spec: string,
  resolveDir: string,
): Promise<string | null> {
  let found: string | null = null;

  await build({
    stdin: {
      contents: `import ${JSON.stringify(spec)};`,
      resolveDir,
      loader: "js",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    // Node's conditions and fields, without esbuild's "module"
    conditions: [],
    mainFields: ["main"],
    logLevel: "silent",
    plugins: [
      {
        name: "unrift-resolve-only",
        setup(b) {
          b.onResolve({ filter: /.*/ }, async (args) => {
            if (args.pluginData?.inner) return;

            const r = await b.resolve(args.path, {
              kind: args.kind,
              resolveDir: args.resolveDir,
              pluginData: { inner: true },
            });

            if (r.errors.length === 0 && !r.external) found = r.path;

            return { path: args.path, external: true };
          });
        },
      },
    ],
  });

  return found;
}

function namesOf(value: unknown): string[] {
  const isNamespace =
    Object.prototype.toString.call(value) === "[object Module]";
  const keys =
    value !== null && (typeof value === "object" || typeof value === "function")
      ? Object.keys(value).filter((k) => k !== "__esModule")
      : [];

  return isNamespace ? keys : [...new Set(["default", ...keys])];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
