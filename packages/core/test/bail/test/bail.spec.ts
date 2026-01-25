import { describe, it, expect } from "@unrift/core";

const ran: string[] = [];

describe("bail", () => {
  it("fails", () => {
    ran.push("fail");
    expect(1).toBe(2);
  });

  it("should not run when bail=true", () => {
    ran.push("should-not-run");
    expect(true).toBe(true);
  });
});

describe("bail check", () => {
  it("verify", () => {
    expect(ran).toEqual(["fail"]);
  });
});
