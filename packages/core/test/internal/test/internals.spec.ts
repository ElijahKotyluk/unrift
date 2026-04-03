import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "@unrift/core";
import { Test } from "../../../src/test.js";
import { TaskMode, TaskStatus } from "../../../src/types.js";

describe("Sample Test Suite", () => {
  let value: number = 0;

  beforeEach(() => {
    value = 42;
  });

  it("should pass this test", () => {
    expect(1 + 1).not.toBe(value);
  });

  it("should have value set to 42", () => {
    expect(value).toBe(42);
  });
});

describe("toEqual", () => {
  it("should correctly compare loose equality", () => {
    expect({}).toEqual({ a: undefined });

    expect([, 1]).toEqual([undefined, 1]);

    expect(
      new (class X {
        x = 1;
      })(),
    ).toEqual({ x: 1 });
  });
});

describe("toStrictEqual", () => {
  it("should correctly compare complex objects", () => {
    const obj1 = {
      name: "Test",
      data: [1, 2, 3],
      nested: {
        flag: true,
        regex: /test/i,
      },
      map: new Map([
        ["key1", "value1"],
        ["key2", "value2"],
      ]),
      set: new Set([1, 2, 3]),
      typedArray: new Uint8Array([1, 2, 3]),
    };

    const obj2 = {
      name: "Test",
      data: [1, 2, 3],
      nested: {
        flag: true,
        regex: /test/i,
      },
      map: new Map([
        ["key1", "value1"],
        ["key2", "value2"],
      ]),
      set: new Set([1, 2, 3]),
      typedArray: new Uint8Array([1, 2, 3]),
    };

    expect(obj1).toStrictEqual(obj2);
  });
});

describe("toThrow", () => {
  it("should pass when function throws expected error", () => {
    expect(() => {
      throw new Error("should pass");
    }).toThrow("should pass");
    expect(() => "no throw").not.toThrow();
  });
});

describe("per-test timeout", () => {
  it("stores timeoutMs on the Test instance", () => {
    const t = new Test("name", () => {}, TaskMode.Default, 1500);
    expect(t.timeoutMs).toBe(1500);
  });

  it("timeoutMs is undefined when not provided", () => {
    const t = new Test("name", () => {}, TaskMode.Default);
    expect(t.timeoutMs).toBe(undefined);
  });

  it("per-test timeout causes failure when exceeded", async () => {
    const t = new Test(
      "slow",
      () => new Promise<void>((r) => setTimeout(r, 300)),
      TaskMode.Default,
      50, // 50ms per-test timeout
    );
    await t.run(5000); // global is generous — per-test should win
    expect(t.status).toBe(TaskStatus.Fail);
    expect(t.error?.message).toContain("timed out");
    expect(t.error?.message).toContain("50 ms");
  });

  it("global timeout applies when no per-test timeout is set", async () => {
    const t = new Test(
      "slow",
      () => new Promise<void>((r) => setTimeout(r, 300)),
      TaskMode.Default,
      // no per-test timeout
    );
    await t.run(50); // 50ms global
    expect(t.status).toBe(TaskStatus.Fail);
    expect(t.error?.message).toContain("timed out");
    expect(t.error?.message).toContain("50 ms");
  });

  it("test passes when it completes within the per-test timeout", async () => {
    const t = new Test(
      "fast",
      () => new Promise<void>((r) => setTimeout(r, 10)),
      TaskMode.Default,
      500,
    );
    await t.run(5000);
    expect(t.status).toBe(TaskStatus.Pass);
  });

  it("per-test timeout overrides a stricter global timeout", async () => {
    const t = new Test(
      "relaxed",
      () => new Promise<void>((r) => setTimeout(r, 100)),
      TaskMode.Default,
      500, // per-test is generous
    );
    await t.run(50); // global is strict — per-test should win
    expect(t.status).toBe(TaskStatus.Pass);
  });
});

describe("async describe guard", () => {
  it("produces a failed test when describe callback is async", () => {
    const configPath = resolve(
      process.cwd(),
      "test/internal/fixtures/unrift.config.ts",
    );
    const binPath = resolve(process.cwd(), "bin/unrift.mjs");
    const proc = spawnSync(
      process.execPath,
      [binPath, "--config", configPath, "--json"],
      { encoding: "utf8" },
    );
    const report = JSON.parse(proc.stdout);

    expect(report.ok).toBe(false);
    expect(report.failed).toBe(1);

    const failed = report.results.filter(
      (r: { status: string }) => r.status === "fail",
    );
    expect(failed[0].error.message).toContain(
      "describe() callbacks must be synchronous",
    );
  });
});
