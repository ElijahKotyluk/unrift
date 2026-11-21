import { it } from "@unrift/core";

// Logs after the file is done, it's still this file's output
it("late", () => {
  setTimeout(() => console.log("log: late"), 50);
});
