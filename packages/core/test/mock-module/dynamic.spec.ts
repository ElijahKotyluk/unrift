import { it, mock } from "@unrift/core";

const spec = "./user-service";

it("needs a string literal", () => {
  mock.module(spec, () => ({}));
});
