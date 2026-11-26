import { assertRegisterState } from "./context.js";
import { getCurrentSuite } from "./suite.js";
import { type PromisableFn } from "./types.js";

type HookFn = PromisableFn<void>;

export function beforeAll(...hooks: HookFn[]): void {
  assertRegisterState("beforeAll");
  getCurrentSuite().beforeAllHooks.push(...hooks);
}

export function afterAll(...hooks: HookFn[]): void {
  assertRegisterState("afterAll");
  getCurrentSuite().afterAllHooks.push(...hooks);
}

export function beforeEach(...hooks: HookFn[]): void {
  assertRegisterState("beforeEach");
  getCurrentSuite().beforeEachHooks.push(...hooks);
}

export function afterEach(...hooks: HookFn[]): void {
  assertRegisterState("afterEach");
  getCurrentSuite().afterEachHooks.push(...hooks);
}
