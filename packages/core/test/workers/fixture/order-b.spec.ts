import { it } from "@unrift/core";

// Slower than c, its results still come first
it("b", () => new Promise((resolve) => setTimeout(resolve, 300)));
