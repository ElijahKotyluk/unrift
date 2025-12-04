import { getCurrentSuite } from "./suite";
import { PromisableFn } from "./types";

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
  getCurrentSuite().beforeAllHooks.push(...hooks);
}
function afterAll(...hooks: HookFn[]): void {
  getCurrentSuite().afterAllHooks.push(...hooks);
}
function beforeEach(...hooks: HookFn[]): void {
  getCurrentSuite().beforeEachHooks.push(...hooks);
}

function afterEach(...hooks: HookFn[]): void {
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
