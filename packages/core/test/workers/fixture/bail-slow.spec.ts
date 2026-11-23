import { it } from "@unrift/core";
import { writeFileSync } from "node:fs";

// Runs in the other worker while bail-fail fails. Synchronous, so the worker
// never yields to read a message before the next test.
it("slow", () => {
  // bail-fail waits for this, so the bail lands while it runs
  if (process.env.BAIL_STARTED) writeFileSync(process.env.BAIL_STARTED, "");

  const end = Date.now() + 1000;

  while (Date.now() < end) {
    // Busy
  }
});
it("after the bail", () => {});
