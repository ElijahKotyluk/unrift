import { it } from "@unrift/core";

// Runs in the other worker while bail-fail fails
it("slow", () => new Promise((resolve) => setTimeout(resolve, 1000)));
it("after the bail", () => {});
