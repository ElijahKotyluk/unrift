import { describe, it, expect } from "@unrift/core";
import {
  isGlobPattern,
  globToRegex,
} from "../../../src/utils/helpers.js";

// ── isGlobPattern ─────────────────────────────────────────────────────────────

describe("isGlobPattern", () => {
  it("returns true when the pattern contains *", () => {
    expect(isGlobPattern("*.ts")).toBe(true);
    expect(isGlobPattern("**/*.spec.ts")).toBe(true);
    expect(isGlobPattern("src/**/test")).toBe(true);
  });

  it("returns true when the pattern contains ?", () => {
    expect(isGlobPattern("file?.ts")).toBe(true);
  });

  it("returns true when the pattern contains [", () => {
    expect(isGlobPattern("file[ab].ts")).toBe(true);
  });

  it("returns true when the pattern contains {", () => {
    expect(isGlobPattern("{spec,test}.ts")).toBe(true);
  });

  it("returns false for plain strings (regex backward compat)", () => {
    expect(isGlobPattern("fixtures")).toBe(false);
    expect(isGlobPattern("\\.spec\\.ts$")).toBe(false);
    expect(isGlobPattern("integration")).toBe(false);
  });
});

// ── globToRegex ───────────────────────────────────────────────────────────────

describe("globToRegex", () => {
  it("* matches any characters within a single path segment", () => {
    const re = globToRegex("*.ts");
    expect(re.test("file.ts")).toBe(true);
    expect(re.test("my-file.ts")).toBe(true);
  });

  it("** matches across path separators including the root level", () => {
    const re = globToRegex("**/*.ts");
    expect(re.test("file.ts")).toBe(true); // root - **/ is optional
    expect(re.test("a/file.ts")).toBe(true);
    expect(re.test("a/b/c/file.ts")).toBe(true);
    expect(re.test("a/b/file.js")).toBe(false); // wrong extension
  });

  it("** followed by path tail (fixtures/**)", () => {
    const re = globToRegex("fixtures/**");
    expect(re.test("fixtures/a.ts")).toBe(true);
    expect(re.test("fixtures/nested/b.ts")).toBe(true);
    expect(re.test("other/a.ts")).toBe(false);
  });

  it("? matches exactly one non-separator character", () => {
    const re = globToRegex("file?.ts");
    expect(re.test("file1.ts")).toBe(true);
    expect(re.test("filea.ts")).toBe(true);
    expect(re.test("file12.ts")).toBe(false); // ? is a single char
  });

  it("character classes [abc] are passed through", () => {
    const re = globToRegex("file[ab].ts");
    expect(re.test("filea.ts")).toBe(true);
    expect(re.test("fileb.ts")).toBe(true);
    expect(re.test("filec.ts")).toBe(false);
  });

  it("{a,b,c} is converted to an alternation group", () => {
    const re = globToRegex("{spec,test}.ts");
    expect(re.test("spec.ts")).toBe(true);
    expect(re.test("test.ts")).toBe(true);
    expect(re.test("other.ts")).toBe(false);
  });

  it("dots are escaped as literal dots", () => {
    const re = globToRegex("*.spec.ts");
    expect(re.test("file.spec.ts")).toBe(true);
    expect(re.test("fileXspecXts")).toBe(false); // X is not a literal dot
  });

  it("regex special characters are escaped (+, ^, $, |)", () => {
    const re = globToRegex("file+name.ts");
    expect(re.test("file+name.ts")).toBe(true);
    expect(re.test("filename.ts")).toBe(false); // + is literal, not a quantifier
  });

  it("handles unclosed bracket gracefully (no throw)", () => {
    expect(() => globToRegex("file[abc.ts")).not.toThrow();
  });

  it("handles unclosed brace gracefully (no throw)", () => {
    expect(() => globToRegex("file{a,b.ts")).not.toThrow();
  });

  it("combined pattern: src/**/{spec,test}.ts", () => {
    const re = globToRegex("src/**/{spec,test}.ts");
    expect(re.test("src/utils/spec.ts")).toBe(true);
    expect(re.test("src/utils/deep/test.ts")).toBe(true);
    expect(re.test("src/utils/other.ts")).toBe(false);
    expect(re.test("lib/utils/spec.ts")).toBe(false);
  });
});
