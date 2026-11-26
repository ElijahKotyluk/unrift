export { beforeEach, afterEach, beforeAll, afterAll } from "./hooks.js";
export {
  defineConfig,
  type UnriftConfigOptions,
  type UnriftCoverageOptions,
} from "./utils/defineConfig.js";
export { describe, it, test, type TestOptions } from "./interface.js";
export { expect, extendMatchers } from "./expect.js";

export type { Matchers, ExpectInterface } from "./expect.js";
export type {
  MatcherContext,
  MatcherFn,
  MatcherMap,
  Promisable,
} from "./types.js";
export { runEngine } from "./run.js";
export type {
  RunEngineResult,
  RunEngineCoverage,
  RunEngineCoverageOptions,
} from "./run.js";
export type { FileCoverage } from "./coverage/convert.js";
export type {
  CoverageMetric,
  CoverageReporter,
  CoverageSummary,
  CoverageThresholds,
} from "./coverage/report.js";
export type { SnapshotSummary, SnapshotUpdateMode } from "./snapshot/state.js";

// Mocking suite
export {
  mock,
  spy,
  spyOn,
  isSpy,
  mockObject,
  mockClass,
  stub,
  mockGlobal,
  mockFetch,
  mockFetchOnce,
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  advanceTimersByTimeAsync,
  runAllTimers,
  runAllTimersAsync,
  runOnlyPendingTimers,
  runOnlyPendingTimersAsync,
  getTimerCount,
  setSystemTime,
  getRealSystemTime,
  doMock,
  unmock,
  listMockedSpecs,
  fromModule,
  mockFs,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
} from "./mock/index.js";
export type {
  Spy,
  MockState,
  MockResult,
  MockFetch,
  FetchMatcher,
  MockResponseInit,
  MockFetchResponse,
  UseFakeTimersOptions,
  FakeableApi,
  FakeFsHandle,
  FakeFsState,
} from "./mock/index.js";
