import { it, mock } from "@unrift/core";

const name = "mocked";

// Runs before `name` exists
mock.module("./user-service", () => ({ getUser: name }));

it("never runs", () => {});
