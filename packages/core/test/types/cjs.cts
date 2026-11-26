import { it, expect, mock } from "@unrift/core";

it("cjs", () => expect(mock.fn()).not.toHaveBeenCalled());
