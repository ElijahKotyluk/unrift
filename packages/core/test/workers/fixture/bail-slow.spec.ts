import { it } from "@unrift/core";

// Runs in the other worker while bail-fail fails. Synchronous, so the worker
// never yields to read a message before the next test.
it("slow", () => {
  const end = Date.now() + 1000;

  while (Date.now() < end) {
    // Busy
  }
});
it("after the bail", () => {});
