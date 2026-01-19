export { beforeEach, afterEach, beforeAll, afterAll } from "./hooks";
export { defineConfig, type UnriftConfigOptions } from "./utils/defineConfig";
export { describe, it } from "./interface";
export { expect, extendMatchers } from "./expect";

export type { Matchers, ExpectInterface } from "./expect";
export type { MatcherContext, MatcherFn, MatcherMap } from "./types";
