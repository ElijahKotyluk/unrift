import { it } from "@unrift/core";

// log-b runs in the other worker while this waits
it("a", async () => {
  console.log("log: a start");
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log("log: a end");
});
