import { describe, it } from "@unrift/core";

// Run through --grep by test/internal/test/grep.spec.ts. "wanted" sits in a
// suite excluded by .only, so it's skipped whichever pattern is used.
describe("focused suite", () => {
  it.only("focused", () => {});
});

describe("unfocused suite", () => {
  it.todo("wanted");
});
