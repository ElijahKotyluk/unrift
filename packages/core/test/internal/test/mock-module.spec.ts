import { describe, it, expect, mock, type Spy } from "@unrift/core";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";

import { findMockCalls } from "../../../src/mock/hoist.js";

import { greet } from "../../mock-module/greet";
import label, { getUser } from "../../mock-module/user-service";
import { value, extra } from "fixture-esm-only";
import { tool, restore } from "../../mock-module/tool";

// Runs before the imports above, and the real module never loads
mock.module("../../mock-module/user-service", () => ({
  getUser: mock.fn(),
  default: "mocked default",
}));

mock.module("node:path", async (importActual) => {
  const real = await importActual<typeof import("node:path")>();

  return { ...real, basename: () => "mocked basename" };
});

// Import-only, and throws if it runs
mock.module("fixture-esm-only", () => ({
  value: "mocked",
  extra: "mocked",
}));

// The unmock inside the factory is keyed too
mock.module("../../mock-module/tool", () => ({
  tool: () => "mocked",
  restore: () => mock.unmock("../../mock-module/tool"),
}));

describe("mock.module", () => {
  it("replaces static imports, in the test and in files it imports", () => {
    // Set here, another file's mock.resetAll() clears the spy
    (getUser as unknown as Spy<typeof getUser>).mockImplementation((id) => ({
      id,
      name: "mocked",
    }));

    expect(greet(1)).toBe("hi mocked");
    expect(getUser).toHaveBeenCalledWith(1);
    expect(label).toBe("mocked default");
    expect((globalThis as Record<string, unknown>).__userServiceLoads).toBe(
      undefined,
    );
  });

  it("mocks a package without running it, export * names included", () => {
    expect([value, extra]).toEqual(["mocked", "mocked"]);
  });

  it("keys a call inside a hoisted factory", async () => {
    expect(tool()).toBe("mocked");
    await restore();
    expect(tool()).toBe("real");
  });

  it("mocks a built-in, with the real module from importActual", () => {
    expect(basename("/a/b.txt")).toBe("mocked basename");
  });

  it("swaps the exports from inside a test, and unmock brings back the real module", async () => {
    mock.module("../../mock-module/user-service", () => ({
      getUser: (id: number) => ({ id, name: "again" }),
    }));
    expect(greet(2)).toBe("hi again");

    await mock.unmock("../../mock-module/user-service");
    expect(greet(3)).toBe("hi real");
    expect(label).toBe("real default");
  });
});

describe("mock.module errors", () => {
  it("explains a factory that uses the file's code, and a specifier it can't see, and follows path aliases", () => {
    const res = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "bin/unrift.mjs"),
        "--config",
        resolve(process.cwd(), "test/mock-module/unrift.config.ts"),
        "--json",
      ],
      { encoding: "utf8" },
    );
    const results = JSON.parse(res.stdout).results as Array<{
      description: string;
      status: string;
      error?: { message: string };
    }>;
    const errors = results.map((r) => r.error?.message).join("\n");

    expect(errors).toContain(
      "name is not defined. A call at the top of the file runs before",
    );
    expect(errors).toContain(
      "Unrift didn't find this call when it bundled the test file",
    );
    expect(
      results.find((r) => r.description.includes("path alias"))?.status,
    ).toBe("pass");
  });
});

describe("findMockCalls", () => {
  it("finds calls, and which ones are at the top of the file", () => {
    const source = `import { mock } from "unrift";
// mock.module("./comment", () => ({}));
const text = "mock.module('./string', () => ({}))";
const re = /mock.module\\("x"/;
const tpl = \`\${mock.module("./template", f)}\`;
mock.module("./a", () => ({ re: /\\)/, s: ")" }));
await mock.module('./b', async () => ({}))
it("t", () => { mock.module("./c", () => ({})); });
const x = mock.module("./d", f);
mock.unmock("./a");
mock.module(spec, f);
if (ok)
  mock.module("./e", f);
else mock.module("./f", f);
for (const k of ks) await mock.module("./g", f);
unmock("./h");
x.unmock("./i");
obj.mock.module("./j", f);
if (ok) /[)]/.test("");
mock.module("./k", () => ({ r: () => mock.unmock("./k") }));
`;
    const calls = findMockCalls(source).map((c) => ({
      spec: c.spec,
      kind: c.kind,
      topLevel: c.topLevel,
      text: source.slice(c.start, c.end),
    }));

    expect(calls).toEqual([
      {
        spec: "./template",
        kind: "module",
        topLevel: false,
        text: 'mock.module("./template", f)',
      },
      {
        spec: "./a",
        kind: "module",
        topLevel: true,
        text: 'mock.module("./a", () => ({ re: /\\)/, s: ")" }));',
      },
      {
        spec: "./b",
        kind: "module",
        topLevel: true,
        text: "await mock.module('./b', async () => ({}))",
      },
      {
        spec: "./c",
        kind: "module",
        topLevel: false,
        text: 'mock.module("./c", () => ({}));',
      },
      {
        spec: "./d",
        kind: "module",
        topLevel: false,
        text: 'mock.module("./d", f);',
      },
      {
        spec: "./a",
        kind: "unmock",
        topLevel: true,
        text: 'mock.unmock("./a");',
      },
      {
        spec: "./e",
        kind: "module",
        topLevel: false,
        text: 'mock.module("./e", f);',
      },
      {
        spec: "./f",
        kind: "module",
        topLevel: false,
        text: 'mock.module("./f", f);',
      },
      {
        spec: "./g",
        kind: "module",
        topLevel: false,
        text: 'await mock.module("./g", f);',
      },
      {
        spec: "./h",
        kind: "unmock",
        topLevel: true,
        text: 'unmock("./h");',
      },
      {
        spec: "./k",
        kind: "module",
        topLevel: true,
        text: 'mock.module("./k", () => ({ r: () => mock.unmock("./k") }));',
      },
      {
        spec: "./k",
        kind: "unmock",
        topLevel: false,
        text: 'mock.unmock("./k")',
      },
    ]);
  });

  it("skips JSX in a .tsx file", () => {
    const source = `const id = <T,>(x: T) => x;
mock.module("./Button", () => ({ Button: () => <p a="(" b={")"}>it's ( <b/></p> }));
mock.module("./a", f);
`;
    const calls = findMockCalls(source, true).map((c) => [c.spec, c.topLevel]);

    expect(calls).toEqual([
      ["./Button", true],
      ["./a", true],
    ]);
  });
});
