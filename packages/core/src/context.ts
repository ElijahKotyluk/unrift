import { AsyncLocalStorage } from "node:async_hooks";

import { Suite } from "./suite.js";

/**
 * The file whose code is running, by async context. A file given up on
 * (stalled) can resume later, in the next file's time: what it registers
 * then goes nowhere (see getCurrentSuite).
 */
export const fileScope = new AsyncLocalStorage<{ abandoned: boolean }>();

export function inAbandonedFile(): boolean {
  return fileScope.getStore()?.abandoned === true;
}

export enum RunState {
  Register = "register",
  Run = "run",
  Idle = "idle",
}

interface UnriftGlobalContext {
  currentSuite: Suite | null;
  state: RunState;
}

export const unriftGlobalContext: UnriftGlobalContext = {
  currentSuite: null,
  state: RunState.Register,
};

export function assertRegisterState(apiName: string) {
  // Lands nowhere, it mustn't throw into the next file either
  if (inAbandonedFile()) return;

  if (unriftGlobalContext.state !== RunState.Register) {
    throw new Error(
      `Unrift: ${apiName}() can only be called during test registration (module import time). ` +
        `You likely called it inside a running test or hook.`,
    );
  }
}
