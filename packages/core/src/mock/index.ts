/**
 * `mock` namespace - single entry point for all mocking utilities.
 *
 * Both forms are supported:
 *   import { mock } from "unrift";
 *   mock.fn();
 *   mock.spyOn(obj, "method");
 *
 *   import { spy, spyOn } from "unrift";
 *   spy();
 *
 * They produce identical objects.
 */

import {
  spy,
  spyOn,
  isSpy,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
} from "./spy.js";
import { mockObject, mockClass } from "./auto.js";
import { stub, mockGlobal } from "./stub.js";
import { mockFetch, mockFetchOnce } from "./fetch.js";
import {
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
} from "./timers.js";
import {
  doMock,
  unmock,
  listMockedSpecs,
  fromModule,
  mockModule,
} from "./module.js";
import { fs as mockFs } from "./fs.js";

export {
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
};

export type { Spy, MockState, MockResult, AnyFn } from "./spy.js";
export type {
  MockFetch,
  FetchMatcher,
  MockResponseInit,
  MockFetchResponse,
} from "./fetch.js";
export type { UseFakeTimersOptions, FakeableApi } from "./timers.js";
export type { FakeFsHandle, FakeFsState } from "./fs.js";

/**
 * Unified mock namespace. Mirrors Jest / Vitest naming so existing test
 * code reads naturally:
 *
 *   mock.fn(impl?)            // spy()
 *   mock.spyOn(obj, key)
 *   mock.object(obj)          // auto-spy every method
 *   mock.class(Ctor)          // auto-spy every method on instances
 *   mock.global(key, value)   // stub on globalThis
 *   mock.stub(target, key, value)
 *   mock.clearAll()
 *   mock.resetAll()
 *   mock.restoreAll()
 */
export const mock = {
  fn: spy,
  spyOn,
  object: mockObject,
  class: mockClass,
  global: mockGlobal,
  stub,
  fetch: mockFetch,
  fetchOnce: mockFetchOnce,
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
  // Replaces a module for the test file, static imports too
  module: mockModule,
  // Mocks an external module for later `await import()` calls
  doMock,
  unmock,
  fromModule,
  listMockedSpecs,
  // File system mocking, layered on doMock. Works with `await import("node:fs")`
  fs: mockFs,
  clearAll: clearAllMocks,
  resetAll: resetAllMocks,
  restoreAll: restoreAllMocks,
} as const;
