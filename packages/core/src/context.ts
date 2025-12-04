import { Suite } from "./suite";

interface UnriftGlobalContext {
  currentSuite: Suite | null;
}
const unriftGlobalContext: UnriftGlobalContext = {
  currentSuite: null,
};

export { unriftGlobalContext, type UnriftGlobalContext };
