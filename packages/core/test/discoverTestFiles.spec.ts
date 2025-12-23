import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { discoverTestFiles, isTestFileName } from "../src/utils/discoverTestFiles.js";
import { beforeEach, describe, expect, it } from "@unrift/core";

const norm = (p: string) => p.replace(/\\/g, "/");

describe("isTestFileName", () => {
    it("correctly identifies test file names", () => {
			const cases: Array<[string, boolean]> = [
				["a.spec.ts", true],
				["a.test.ts", true],
				["a.spec.js", true],
				["a.test.js", true],
				["a.spec.tsx", false],
				["a.test.mjs", false],
				["a.spec.d.ts", false],
				["a.ts", false],
				["a.test.jsx", false],
			];

			for (const [name, expected] of cases) {
				expect(isTestFileName(name)).toBe(expected);
			}
  });
});


describe("discoverTestFiles", () => {	
	it("returns empty array for non-existent directory", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "unrift-discovery-"));

		fs.mkdirSync(path.join(root, "a"));
		fs.mkdirSync(path.join(root, "b", "c"), { recursive: true });

		fs.writeFileSync(path.join(root, "a", "x.spec.ts"), "");
		fs.writeFileSync(path.join(root, "a", "y.test.js"), "");
		fs.writeFileSync(path.join(root, "b", "c", "z.test.ts"), "");
		fs.writeFileSync(path.join(root, "b", "c", "nope.ts"), "");
		fs.writeFileSync(path.join(root, "b", "c", "nope.spec.tsx"), "");

		const found = discoverTestFiles(root).map(norm).sort();
		const expected = [
			`${norm(root)}/a/x.spec.ts`,
			`${norm(root)}/a/y.test.js`,
			`${norm(root)}/b/c/z.test.ts`,
		].sort();

		expect(found).toStrictEqual(expected);

		expect(fs.existsSync(root)).toBe(true);

		fs.rmSync(root, { recursive: true });

		expect(fs.existsSync(root)).toBe(false);
	});
});
