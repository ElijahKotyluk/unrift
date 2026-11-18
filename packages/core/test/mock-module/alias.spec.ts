// Not an import: import { it } from "@unrift/core";
import { it, expect, mock /* the factory uses it */ } from "@unrift/core";

import { getUser } from "@fixtures/user-service";

mock.module("./user-service", () => ({
  getUser: mock.fn(() => ({ id: 1, name: "aliased" })),
}));

/* import { expect } from "@unrift/core"; */
it("mocks a file imported through a path alias", () => {
  expect(getUser(1).name).toBe("aliased");
});
