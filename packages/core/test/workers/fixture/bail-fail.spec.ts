import { it, expect } from "@unrift/core";
import { existsSync } from "node:fs";

it("fails", async () => {
  // Fail once bail-slow is running, at most a few seconds from now
  const started = process.env.BAIL_STARTED;
  const until = Date.now() + 5000;

  while (started && !existsSync(started) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(1).toBe(2);
});
