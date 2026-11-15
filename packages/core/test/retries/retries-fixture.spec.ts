import { describe, it, beforeEach, afterEach } from "@unrift/core";

// Run by test/internal/test/retries.spec.ts. Config sets retries: 1.

describe("body failures", () => {
  let state = 0;
  let cleaned = true;
  let flakyRuns = 0;
  let defaultRuns = 0;

  beforeEach(() => {
    state = 0;
  });

  afterEach(() => {
    cleaned = true;
  });

  it(
    "flaky",
    () => {
      // Both hooks must run around every attempt.
      if (++state !== 1) throw new Error("beforeEach did not rerun");
      if (!cleaned) throw new Error("afterEach did not run");
      cleaned = false;
      if (++flakyRuns < 3) throw new Error(`attempt ${flakyRuns} failed`);
    },
    { retries: 2 },
  );

  it(
    "always fails",
    () => {
      throw new Error("nope");
    },
    { retries: 2 },
  );

  it("uses config default", () => {
    if (++defaultRuns < 2) throw new Error("first attempt failed");
  });

  it(
    "opts out",
    () => {
      throw new Error("no retry");
    },
    { retries: 0 },
  );
});

describe("beforeEach failure", () => {
  let calls = 0;

  beforeEach(() => {
    if (++calls === 1) throw new Error("setup flaked");
  });

  it("recovers from setup", () => {});
});

describe("afterEach failure", () => {
  let calls = 0;

  afterEach(() => {
    if (++calls === 1) throw new Error("teardown flaked");
  });

  it("recovers from teardown", () => {});
});

describe("timeout with failing teardown", () => {
  afterEach(() => {
    throw new Error("teardown failed");
  });

  it("times out", () => new Promise<void>(() => {}), {
    timeout: 20,
    retries: 2,
  });
});
