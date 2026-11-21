import { it } from "@unrift/core";

// Still running when late-1 logs from its timer
it("slow", async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log("log: first");
});
