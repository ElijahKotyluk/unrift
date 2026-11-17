import { it, expect, mock } from "@unrift/core";

import { getUser } from "@fixtures/user-service";

mock.module("./user-service", () => ({
  getUser: () => ({ id: 1, name: "aliased" }),
}));

it("mocks a file imported through a path alias", () => {
  expect(getUser(1).name).toBe("aliased");
});
