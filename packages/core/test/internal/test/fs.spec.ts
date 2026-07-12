import { describe, it, expect, afterEach, mock } from "@unrift/core";

afterEach(() => {
  mock.restoreAll();
});

describe("mock.fs - handle API", () => {
  it("starts empty when called with no initial state", () => {
    const fs = mock.fs();
    expect(fs.exists("/anything")).toBe(false);
    expect(fs.list("/")).toEqual([]);
  });

  it("seeds from an initial state map", () => {
    const fs = mock.fs({
      "/tmp/config.json": '{"key":"value"}',
      "/data/users.csv": "id,name\n1,alice",
    });

    expect(fs.read("/tmp/config.json")).toBe('{"key":"value"}');
    expect(fs.read("/data/users.csv")).toBe("id,name\n1,alice");
    expect(fs.exists("/tmp/config.json")).toBe(true);
  });

  it("write + read roundtrip via the handle", () => {
    const fs = mock.fs();
    fs.write("/tmp/x", "hello");
    expect(fs.read("/tmp/x")).toBe("hello");
  });

  it("auto-creates parent directories on write", () => {
    const fs = mock.fs();
    fs.write("/deep/nested/path/file.txt", "ok");
    expect(fs.exists("/deep/nested/path/file.txt")).toBe(true);
  });

  it("delete returns true on success, false on missing", () => {
    const fs = mock.fs({ "/tmp/x": "hi" });
    expect(fs.delete("/tmp/x")).toBe(true);
    expect(fs.delete("/tmp/x")).toBe(false);
    expect(fs.exists("/tmp/x")).toBe(false);
  });

  it("list returns directory contents", () => {
    const fs = mock.fs({
      "/dir/a.txt": "1",
      "/dir/b.txt": "2",
      "/dir/c.txt": "3",
    });

    expect(fs.list("/dir").sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("toJSON dumps current state", () => {
    const fs = mock.fs({ "/tmp/x": "hi" });
    fs.write("/tmp/y", "bye");

    const snapshot = fs.toJSON();
    expect(snapshot["/tmp/x"]).toBe("hi");
    expect(snapshot["/tmp/y"]).toBe("bye");
  });

  it("fromJSON replaces current state", () => {
    const fs = mock.fs({ "/old": "gone" });
    fs.fromJSON({ "/new": "fresh" });

    expect(fs.read("/old")).toBe(null);
    expect(fs.read("/new")).toBe("fresh");
  });
});

describe("mock.fs - module interception", () => {
  it("await import('node:fs') returns the fake", async () => {
    mock.fs({ "/tmp/x": "from fake" });

    const fs = await import("node:fs");
    expect(fs.readFileSync("/tmp/x", "utf8")).toBe("from fake");
  });

  it("writeFileSync through the fake updates the volume", async () => {
    // memfs starts empty - no /tmp like real Node. Write to root-level
    // or seed the dir first.
    const handle = mock.fs();
    const fs = await import("node:fs");

    fs.writeFileSync("/created", "hello world");

    expect(handle.read("/created")).toBe("hello world");
  });

  it("node:fs/promises is also intercepted", async () => {
    mock.fs({ "/tmp/async": "promised" });

    const fsp = await import("node:fs/promises");
    const content = await fsp.readFile("/tmp/async", "utf8");
    expect(content).toBe("promised");
  });
});

describe("mock.fs - lifecycle", () => {
  it("handle.restore tears down the module-mocking registration", async () => {
    const handle = mock.fs({ "/x": "from fake" });

    const fakeFs = await import("node:fs");
    expect(fakeFs.readFileSync("/x", "utf8")).toBe("from fake");

    handle.restore();

    // The backend volume stays alive intentionally so users can post-mortem
    // inspect via handle.toJSON(). What restore() actually undoes is the
    // module-mocking registration - a fresh mock.fs() now sees a blank
    // volume rather than the previous one.
    expect(handle.read("/x")).toBe("from fake");

    const fresh = mock.fs();
    expect(fresh.exists("/x")).toBe(false);
  });

  it("mock.restoreAll undoes mock.fs registration", () => {
    mock.fs({ "/tmp/x": "y" });
    mock.restoreAll();

    // The fake is gone - re-calling mock.fs creates a fresh, empty one.
    const fresh = mock.fs();
    expect(fresh.exists("/tmp/x")).toBe(false);
  });

  it("calling mock.fs again replaces the previous volume", () => {
    const first = mock.fs({ "/file1": "a" });
    const second = mock.fs({ "/file2": "b" });

    expect(second.exists("/file1")).toBe(false);
    expect(second.exists("/file2")).toBe(true);
    // The first handle still references its (now-orphaned) volume.
    expect(first.exists("/file1")).toBe(true);
  });

  it("restore() on a superseded handle does not tear down the newer interception", async () => {
    const first = mock.fs({ "/a": "1" });
    mock.fs({ "/b": "2" }); // supersedes `first`

    // Holding `first` for snapshotting and restoring it must NOT rip out the
    // active (second) volume - this is the flakiness guard.
    first.restore();

    const fs = await import("node:fs");
    expect(fs.existsSync("/b")).toBe(true);
    expect(fs.existsSync("/a")).toBe(false);
  });
});
