import { it } from "@unrift/core";

// Passes, then throws from a timer while order-b still runs in the other worker
it("leaks", () => {
  setTimeout(() => {
    throw new Error("leaked boom");
  }, 50);
});
