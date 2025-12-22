import { getCurrentSuite } from "./suite";
import { PromisableFn } from "./types";
import { assertRegisterPhase } from "./context";

type HookFn = PromisableFn<void>;

type Hook = Array<HookFn>;

interface Hooks {
  beforeAll: Hook;
  afterAll: Hook;
  beforeEach: Hook;
  afterEach: Hook;
}

type HookName = keyof Hooks;

function beforeAll(...hooks: HookFn[]): void {
  assertRegisterPhase("beforeAll");
  getCurrentSuite().beforeAllHooks.push(...hooks);
}
function afterAll(...hooks: HookFn[]): void {
  assertRegisterPhase("afterAll");
  getCurrentSuite().afterAllHooks.push(...hooks);
}
function beforeEach(...hooks: HookFn[]): void {
  assertRegisterPhase("beforeEach");
  getCurrentSuite().beforeEachHooks.push(...hooks);
}

function afterEach(...hooks: HookFn[]): void {
  assertRegisterPhase("afterEach");
  getCurrentSuite().afterEachHooks.push(...hooks);
}

export {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  type Hooks,
  type HookName,
  type Hook,
  type HookFn,
};
