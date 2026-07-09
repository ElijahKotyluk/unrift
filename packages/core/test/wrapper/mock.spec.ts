import { describe, it, expect, mock } from "@unrift/core";

// This spec is run THROUGH the `unrift` wrapper bin (see
// test/internal/test/wrapper.spec.ts). If the wrapper bin fails to register
// the module loader, mock.doMock() throws "requires the Unrift CLI loader"
// and this test fails - which is exactly the regression we're guarding.
describe("wrapper module mocking", () => {
  it("mock.doMock works through the unrift wrapper bin", async () => {
    mock.doMock("node:os", () => ({ platform: () => "wrapper-mocked" }));
    const os = await import("node:os");
    expect(os.platform()).toBe("wrapper-mocked");
    mock.restoreAll();
  });
});
