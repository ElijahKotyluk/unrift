import { Suite } from "./suite";

enum Phase {
  Register = "register",
  Run = "run",
  Idle = "idle",
}

type UnriftPhase = Phase;

interface UnriftGlobalContext {
  currentSuite: Suite | null;
  phase: UnriftPhase;
}

const unriftGlobalContext: UnriftGlobalContext = {
  currentSuite: null,
  phase: Phase.Register,
};

function assertRegisterPhase(apiName: string) {
  if (unriftGlobalContext.phase !== Phase.Register) {
    throw new Error(
      `Unrift: ${apiName}() can only be called during test registration (module import time). ` +
        `You likely called it inside a running test or hook.`,
    );
  }
}

export { assertRegisterPhase, Phase, unriftGlobalContext };
