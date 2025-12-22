import {
  describe,
  it,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  expect,
} from "@unrift/core";

describe("hooks order", () => {
  const events: string[] = [];

  beforeAll(() => {
    events.push("beforeAll");
  });
  beforeEach(() => {
    events.push("beforeEach");
  });
  afterEach(() => {
    events.push("afterEach");
  });
  afterAll(() => {
    events.push("afterAll");
    expect(events).toStrictEqual([
      "beforeAll",
      "beforeEach",
      "test",
      "afterEach",
      "beforeEach",
      "test2",
      "afterEach",
      "afterAll",
    ]);
  });

  it("runs test 1", () => {
    events.push("test");
  });

  it("runs test 2", () => {
    events.push("test2");
  });
});
