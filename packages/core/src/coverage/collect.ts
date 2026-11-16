import { Session } from "node:inspector/promises";

export type V8Range = { startOffset: number; endOffset: number; count: number };

export type V8Function = {
  functionName: string;
  ranges: V8Range[];
  isBlockCoverage: boolean;
};

export type V8ScriptCoverage = {
  scriptId: string;
  url: string;
  functions: V8Function[];
};

// One session for the whole process. Stopping and starting again between
// watch runs would lose counts for code compiled in an earlier run, so it
// stays on and every take resets the counts instead.
let session: Session | null = null;

export async function startCoverage(): Promise<void> {
  if (session) {
    // Drop whatever ran between runs
    await session.post("Profiler.takePreciseCoverage");

    return;
  }

  session = new Session();
  session.connect();

  await session.post("Profiler.enable");
  await session.post("Profiler.startPreciseCoverage", {
    callCount: true,
    detailed: true,
  });
}

export async function takeCoverage(): Promise<V8ScriptCoverage[]> {
  if (!session) return [];

  const { result } = await session.post("Profiler.takePreciseCoverage");

  return result as V8ScriptCoverage[];
}

/** Turns coverage off, a run without it shouldn't pay for counting. */
export async function stopCoverage(): Promise<void> {
  if (!session) return;

  const current = session;

  session = null;

  try {
    await current.post("Profiler.stopPreciseCoverage");
    await current.post("Profiler.disable");
  } finally {
    current.disconnect();
  }
}
