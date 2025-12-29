import { Suite } from "./suite";

enum RunState {
  Register = "register",
  Run = "run",
  Idle = "idle",
}

type UnriftState = RunState;

interface UnriftGlobalContext {
  currentSuite: Suite | null;
  state: UnriftState;
}

const unriftGlobalContext: UnriftGlobalContext = {
  currentSuite: null,
  state: RunState.Register,
};

function assertRegisterState(apiName: string) {
  if (unriftGlobalContext.state !== RunState.Register) {
    throw new Error(
      `Unrift: ${apiName}() can only be called during test registration (module import time). ` +
        `You likely called it inside a running test or hook.`,
    );
  }
}

export { assertRegisterState, RunState, unriftGlobalContext };
