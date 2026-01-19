import { Suite } from "./suite";

export enum RunState {
  Register = "register",
  Run = "run",
  Idle = "idle",
}

type UnriftState = RunState;

interface UnriftGlobalContext {
  currentSuite: Suite | null;
  state: UnriftState;
}

export const unriftGlobalContext: UnriftGlobalContext = {
  currentSuite: null,
  state: RunState.Register,
};

export function assertRegisterState(apiName: string) {
  if (unriftGlobalContext.state !== RunState.Register) {
    throw new Error(
      `Unrift: ${apiName}() can only be called during test registration (module import time). ` +
        `You likely called it inside a running test or hook.`,
    );
  }
}
