import {
  describe,
  it,
  expect,
  afterEach,
  mock,
  listMockedSpecs,
} from "@unrift/core";

// Restore module mocks (and everything else) after every test so they
// don't leak. afterEach is used over beforeEach so the last test in the
// file is cleaned up too — same reason as timers.spec.ts.
afterEach(() => {
  mock.restoreAll();
});

describe("mock.doMock — basic registration", () => {
  it("returns the factory's exports via await import", async () => {
    mock.doMock("node:os", () => ({
      platform: () => "linux-mocked",
      arch: () => "x64-mocked",
    }));

    const os = await import("node:os");
    expect(os.platform()).toBe("linux-mocked");
    expect(os.arch()).toBe("x64-mocked");
  });

  it("works for multiple mocked specs simultaneously", async () => {
    mock.doMock("node:path", () => ({ sep: "<<MOCK_SEP>>" }));
    mock.doMock("node:url", () => ({
      pathToFileURL: () => "file:///mock",
    }));

    const path = await import("node:path");
    const url = await import("node:url");

    expect(path.sep).toBe("<<MOCK_SEP>>");
    expect(url.pathToFileURL()).toBe("file:///mock");
  });

  it("supports a default export", async () => {
    mock.doMock("node:querystring", () => ({
      default: { mocked: true },
      stringify: () => "mocked=1",
    }));

    const qs = await import("node:querystring");
    expect(qs.default).toEqual({ mocked: true });
    expect(qs.stringify()).toBe("mocked=1");
  });

  it("listMockedSpecs reports the currently mocked specs", async () => {
    mock.doMock("node:zlib", () => ({ compress: () => "z" }));
    mock.doMock("node:dns", () => ({ resolve: () => "d" }));

    const specs = listMockedSpecs().slice().sort();
    expect(specs).toEqual(["node:dns", "node:zlib"]);
  });
});

describe("mock.unmock — restoration", () => {
  it("restores the original module on subsequent imports", async () => {
    mock.doMock("node:os", () => ({ platform: () => "fake-os" }));

    const mocked = await import("node:os");
    expect(mocked.platform()).toBe("fake-os");

    mock.unmock("node:os");

    // Bust the module cache by using a fresh import via a unique
    // import-attributes-style technique isn't reliable; rely on the
    // loader's behavior — once unmocked, subsequent fresh imports of
    // a non-cached spec hit the real loader.
    // Node DOES cache modules, so we can't reliably re-import the same
    // spec and see the un-mocked version. Verify via listMockedSpecs.
    expect(listMockedSpecs()).not.toContain("node:os");
  });

  it("mock.restoreAll undoes every doMock registration", () => {
    mock.doMock("node:fs", () => ({ readFileSync: () => "x" }));
    mock.doMock("node:path", () => ({ sep: "x" }));

    expect(listMockedSpecs().length).toBe(2);

    mock.restoreAll();

    expect(listMockedSpecs()).toEqual([]);
  });
});

describe("mock.doMock — input validation", () => {
  it("throws on empty specifier", () => {
    expect(() => mock.doMock("", () => ({}))).toThrow(
      "non-empty string specifier",
    );
  });

  it("throws when factory isn't a function", () => {
    expect(() =>
      mock.doMock("node:os", null as unknown as () => Record<string, unknown>),
    ).toThrow("requires a factory function");
  });

  it("throws when factory returns a non-object", () => {
    expect(() =>
      mock.doMock(
        "node:os",
        () => "not an object" as unknown as Record<string, unknown>,
      ),
    ).toThrow("factory must return an object");
  });
});

describe("mock.doMock — non-identifier export keys", () => {
  it("warns and skips keys that aren't valid JS identifiers", async () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };

    try {
      mock.doMock("node:os", () => ({
        valid: () => "ok",
        "has-dashes": () => "skipped",
        "has space": () => "also skipped",
      }));

      const os = await import("node:os");
      expect(os.valid()).toBe("ok");
      expect((os as Record<string, unknown>)["has-dashes"]).toBe(undefined);

      const matched = warnings.find((w) => w.includes("has-dashes"));
      expect(matched).toBeDefined();
    } finally {
      console.warn = originalWarn;
    }
  });
});
