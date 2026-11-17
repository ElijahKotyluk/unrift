import { build, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { findMockCalls, type MockCall } from "../mock/hoist";
import { MODULE_MOCKS_GLOBAL_KEY } from "../mock/module";

const NAMESPACE = "unrift-mock";
const PRELUDE = "unrift-mock-prelude";

// Imports from these give the hoisted factories `mock` and the rest
const UNRIFT_IMPORT =
  /(?:^|[;\n])[ \t]*import\s+(?!type\b)([\w$*{}\s,]+?)\s+from\s*(["'])(unrift|@unrift\/core)\2/g;

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
export function moduleMockCalls(source: string): MockCall[] {
  if (!source.includes("mock")) return [];

  const calls = findMockCalls(source);

  return calls.some((c) => c.kind === "module") ? calls : [];
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
  calls: MockCall[],
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

          const keyed = (call: MockCall) => {
            const target = specs.get(call.spec)!;

            return (
              source.slice(call.start, call.specStart) +
              JSON.stringify(target.key) +
              source.slice(call.specEnd, call.end)
            );
          };

          const imports = [...source.matchAll(UNRIFT_IMPORT)].map(
            (m) => `import ${m[1]} from ${JSON.stringify(m[3])};`,
          );
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

          return t && !t.path
            ? { path: t.key, namespace: NAMESPACE, pluginData: t }
            : undefined;
        }

        const r = await b.resolve(args.path, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          importer: args.importer,
          pluginData: { unriftSkip: true },
        });

        const t = r.errors.length === 0 ? targetsByPath.get(r.path) : undefined;

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

/** What the real module exports, so the stand-in can export the same. */
async function exportNames(t: Target, testFile: string): Promise<string[]> {
  const require = createRequire(testFile);

  if (t.path) {
    const result = await build({
      entryPoints: [t.path],
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "node",
      target: "node22",
      packages: "external",
      absWorkingDir: dirname(t.path),
      logLevel: "silent",
    });
    const input = Object.entries(result.metafile.inputs).find(
      ([path]) => resolve(dirname(t.path!), path) === t.path,
    );

    if (input?.[1].format !== "cjs") {
      return Object.values(result.metafile.outputs)[0]?.exports ?? [];
    }

    return namesOf(require(t.path));
  }

  try {
    // The stand-in loads it with import(), so read the names the same way
    const resolved = require.resolve(t.spec);
    const url = isAbsolute(resolved) ? pathToFileURL(resolved).href : resolved;

    return namesOf(await import(url));
  } catch (err) {
    throw new Error(
      `mock.module("${t.spec}"): can't read the module's exports: ${(err as Error).message}`,
    );
  }
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
