import { describe, it, beforeAll, expect } from "@unrift/core";

describe("beforeAll failure", () => {
  let ran = false;

  beforeAll(() => {
    throw new Error("Failure in beforeAll");
  });

  it("should not run", () => {
    ran = true;
  });

  it("should not run either", () => {
    ran = true;
  });

  // This test is in the same suite so it won't run either (suite never "entered").
  // We assert via a separate describe to ensure the run continues overall.
});

describe("beforeAll failure does not stop other suites", () => {
  it("still runs later tests", () => {
    expect(true).toBe(true);
  });
});
