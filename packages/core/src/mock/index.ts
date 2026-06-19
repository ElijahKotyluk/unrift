/**
 * `mock` namespace — single entry point for all mocking utilities.
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
} from "./spy";
import { mockObject, mockClass } from "./auto";
import { stub, mockGlobal } from "./stub";
import { mockFetch, mockFetchOnce } from "./fetch";
import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  runAllTimers,
  runOnlyPendingTimers,
  getTimerCount,
  setSystemTime,
  getRealSystemTime,
} from "./timers";
import { doMock, unmock, listMockedSpecs } from "./module";

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
  runAllTimers,
  runOnlyPendingTimers,
  getTimerCount,
  setSystemTime,
  getRealSystemTime,
  doMock,
  unmock,
  listMockedSpecs,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
};

export type { Spy, MockState, MockResult, AnyFn } from "./spy";
export type {
  MockFetch,
  FetchMatcher,
  MockResponseInit,
  MockFetchResponse,
} from "./fetch";
export type { UseFakeTimersOptions } from "./timers";
export type { LoaderMessage } from "./module";

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
  runAllTimers,
  runOnlyPendingTimers,
  getTimerCount,
  setSystemTime,
  getRealSystemTime,
  // Tier A module mocking — dynamic imports of external specs only.
  // The hoisted `mock.module(spec, factory)` for static imports is
  // planned for Tier B and intentionally not exposed yet.
  doMock,
  unmock,
  clearAll: clearAllMocks,
  resetAll: resetAllMocks,
  restoreAll: restoreAllMocks,
} as const;
