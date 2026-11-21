import { it } from "@unrift/core";

it("exits", () => {
  console.log("log: before exit");
  process.exit(3);
});
