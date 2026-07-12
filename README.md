# UNRIFT

[![npm version](https://img.shields.io/npm/v/unrift)](https://www.npmjs.com/package/unrift)
[![npm downloads](https://img.shields.io/npm/dm/unrift)](https://www.npmjs.com/package/unrift)
[![CI](https://github.com/ElijahKotyluk/unrift/actions/workflows/ci.yml/badge.svg)](https://github.com/ElijahKotyluk/unrift/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ElijahKotyluk/unrift/blob/main/LICENSE)
[![Node](https://img.shields.io/node/v/unrift)](https://nodejs.org)
[![Docs](https://img.shields.io/badge/docs-unrift.pages.dev-00b4d8)](https://unrift.pages.dev)

A lightweight, fast TypeScript test framework with ESM-first design.

**[Documentation](https://unrift.pages.dev)** · [Getting Started](https://unrift.pages.dev/getting-started/installation) · [API Reference](https://unrift.pages.dev/reference/matchers)

## Features

- **ESM-first** with CJS fallback
- **TypeScript native** - esbuild-powered transforms, no separate compile step
- **Familiar API** - `describe` / `it` / `expect` (Jest/Vitest compatible)
- **Rich matcher set** - deep equality, `toMatchObject`, `toHaveProperty`, numeric, async, and more
- **Extensible matchers** via `expect.extend()`
- **Async assertions** - `resolves` / `rejects` with full `.not` support
- **Test modifiers** - `.only`, `.skip`, `.todo`
- **Built-in mocking suite** - spies, `mock.fetch`, fake timers and `Date`, an in-memory `mock.fs`, plus Tier A module mocking
- **Watch mode** - re-runs tests on file changes (`--watch`)
- **Bail mode** and configurable timeouts
- **JSON output** for CI integration
- **Programmatic API** - `runEngine` for use in custom tooling
- **Zero config** - works out of the box

## Install

```bash
npm install -D unrift
# or
pnpm add -D unrift
# or
yarn add -D unrift
```

## Quick Start

```ts
// math.spec.ts
import { describe, it, expect } from "unrift";

describe("math", () => {
  it("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });

  it("compares objects", () => {
    expect({ a: 1 }).toEqual({ a: 1 });
  });
});
```

```bash
npx unrift
```

For more examples, see the [Quick Start guide](https://unrift.pages.dev/getting-started/quick-start).

## Documentation

Visit **[unrift.pages.dev](https://unrift.pages.dev)** for the full documentation:

- [Installation](https://unrift.pages.dev/getting-started/installation)
- [Configuration](https://unrift.pages.dev/guide/configuration)
- [CLI](https://unrift.pages.dev/guide/cli)
- [Matchers](https://unrift.pages.dev/reference/matchers)
- [Hooks](https://unrift.pages.dev/reference/hooks)
- [Custom Matchers](https://unrift.pages.dev/guide/custom-matchers)
- [Async Testing](https://unrift.pages.dev/guide/async-testing)
- [Migrating from Jest](https://unrift.pages.dev/guide/migrating-from-jest)
- [Programmatic API](https://unrift.pages.dev/reference/programmatic-api)

## License

MIT
