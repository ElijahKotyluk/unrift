# Changelog

Versions are `@unrift/core` / `unrift`.

## 0.8.0 / 0.9.0 - 2026-11-16

- Coverage: `--coverage` reports lines, functions and branches of the files the tests loaded, TypeScript mapped back to its source
- `coverage` config: `include`, `exclude`, `reporter` (`text`, `lcov`, `json`), `reportsDirectory`, `thresholds`
- `--coverage-reporter <name>`, turns coverage on too
- A threshold that isn't met fails the run
- `runEngine` takes `coverage` and returns `coverage` with per-file data and a summary, `--json` gets a `coverage` block
- Fix: in watch mode (or a second `runEngine` call) an edit to a file a test or the config imports was ignored until the test or config file itself changed

## 0.7.0 / 0.8.0 - 2026-11-15

- Breaking: Node 18 and 20 are no longer supported, Unrift needs Node 22.12+. Both are end-of-life and Node 20 didn't get the October and November 2026 security fixes. 22.12 is also the first 22.x that can `require()` an ES module, so CommonJS test files work

## 0.6.0 / 0.7.0 - 2026-11-15

- Snapshot testing: `toMatchSnapshot(hint?)` and `toMatchInlineSnapshot(snapshot?)`
- Snapshot files live in `__snapshots__/<file>.snap` next to the test file, same keys and layout as Jest
- `-u, --update-snapshots` overwrites mismatches and removes obsolete snapshots. In watch mode it only applies to the first run
- On CI (`CI` env var set) new snapshots aren't written and the test fails instead
- Obsolete snapshots fail the run until removed with `-u`, the report lists each one by file and key
- Snapshots of tests that didn't run (skipped, `--grep`, `.only`, failed, bailed) aren't obsolete
- A snapshot file that can't be read or written fails the run
- Own serializer in Jest's format, no `pretty-format` dependency
- `runEngine` takes `updateSnapshots` and returns a `snapshots` summary, `--json` gets a `snapshots` block
- `SnapshotSummary` and `SnapshotUpdateMode` types exported
- Fix: test bundles are written to the real path of the cache dir, source map paths didn't resolve on macOS
- Fix: `--watch` crashed after the first run with `ERR_MODULE_NOT_FOUND`
- Fix: in watch mode (or a second `runEngine` call) test files that didn't change ran no tests, ESM and CommonJS
- Fix: tests registered before a file's import error ran anyway, now they're skipped
- Watch mode reruns when you edit or delete a `.snap`, but not on the run's own snapshot writes, and picks up folders created after it started
- Not supported yet: property matchers, `.not` with either snapshot matcher

## 0.5.1 / 0.6.1 - 2026-11-15

- `await expect(promise).rejects.toThrow(...)` works with a string, regex, error class or object, it used to throw "expects a function"
- `.resolves` / `.rejects` also take a function that returns a promise
- Under `.resolves` / `.rejects`, `toThrow` only counts an Error, same as Jest
- Failure messages talk about the promise instead of "function", and values that can't be stringified don't crash the matcher
- Custom matchers get `this.promise` (`""`, `"resolves"` or `"rejects"`)
- `toThrow({ message: /re/g })` isn't stateful anymore
- Breaking: `expect(42).resolves.toBe(42)` used to pass, now it throws like Jest

## 0.5.0 / 0.6.0 - 2026-11-15

- Matchers: `toBeCloseTo(expected, precision?)` and `toContainEqual(expected)`
- `-g, --grep <pattern>` runs tests by name, works with `.only`, `--bail` and `--watch`
- Test retries: `it(name, fn, { retries: 3 })` or `retries` in the config. Timeouts aren't retried
- Output shows how many attempts a test took, `--json` gets an `attempts` field

## 0.4.0 / 0.5.0 - 2026-07-12

- Built-in mocking suite: spies, `mock.fn`, `mock.spyOn`, class and object auto-mocking, stubs and global mocks
- `mock.fetch` request mocking
- Fake timers and `Date`
- In-memory `mock.fs`
- Module mocking Tier A: `mock.doMock` for dynamic imports of external specifiers

## 0.3.0 / 0.4.0, 0.4.1 - 2026-04-03

- `-w, --watch` re-runs tests on file changes
- Matchers: `toBeGreaterThanOrEqual`, `toBeLessThanOrEqual`, `toBeNaN`, `toBeFinite`, `toMatchObject`, `toHaveProperty`
- `includes` / `excludes` config options
- Packages are versioned and published separately
- `unrift` README

## 0.2.1 / 0.3.1, 0.3.2 - 2026-04-01

- Documentation site and README
- `RunEngineResult` type exported from `unrift`

## 0.2.0 / 0.2.0, 0.3.0 - 2026-03-24

- `unrift` package, re-exports `@unrift/core` with the CLI
- Publish workflow

## 0.1.0 - Initial Release

- Test registration: `describe`, `it`/`test` with `.only`, `.skip`, `.todo`
- Hooks: `beforeAll`, `afterAll`, `beforeEach`, `afterEach` with proper inheritance
- Matchers: `toBe`, `toEqual`, `toStrictEqual`, `toMatch`, `toThrow`, `toContain`, `toHaveLength`, `toBeGreaterThan`, `toBeLessThan`, `toBeInstanceOf`, `toBeDefined`, `toBeUndefined`, `toBeTruthy`, `toBeFalsy`, `toBeNull`
- Async assertions: `expect.resolves` / `expect.rejects`
- Custom matchers via `expect.extend()`
- CLI with pattern filter, `--bail`, `--timeout`, `--json`, `--config`, `--list`, `--version`
- Configuration via `unrift.config.ts` with `defineConfig()`
- ESM + CJS dual-package support
- esbuild-based TypeScript transform with SHA256 content-hash caching
- Structural diff output for failed assertions
- Bail mode: stop on first failure
- Node.js 18+ support
