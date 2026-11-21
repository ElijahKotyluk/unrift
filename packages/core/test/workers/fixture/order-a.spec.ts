import { it, expect } from "@unrift/core";
import { isMainThread } from "node:worker_threads";

it("a runs in a worker", () => {
  expect(isMainThread).toBe(false);
});
