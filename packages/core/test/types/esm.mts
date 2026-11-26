import { it, expect, mock } from "@unrift/core";

it("esm", () => expect(mock.fn()).not.toHaveBeenCalled());
