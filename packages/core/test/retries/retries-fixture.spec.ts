import { describe, it, beforeEach } from "@unrift/core";

// Run by test/internal/test/retries.spec.ts. Config sets retries: 1.
let state = 0;
let flakyRuns = 0;
let defaultRuns = 0;

describe("retries", () => {
  beforeEach(() => {
    state = 0;
  });

  it(
    "flaky",
    () => {
      // Fails if beforeEach didn't reset state for this attempt.
      if (++state !== 1) throw new Error("beforeEach did not rerun");
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
