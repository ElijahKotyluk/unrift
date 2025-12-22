import { describe, it, expect } from "@unrift/core";

const ran: string[] = [];

describe("only/skip", () => {
  it.skip("skipped test", () => {
    ran.push("skip");
  });

  it("normal test should be skipped when any only exists", () => {
    ran.push("normal");
  });

  it.only("only test runs", () => {
    ran.push("only");
    expect(true).toBe(true);
  });
});

describe("only/skip check", () => {
  it("verify behavior", () => {
    expect(ran).toEqual(["only"]);
  });
});
