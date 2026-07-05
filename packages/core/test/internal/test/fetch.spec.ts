import { describe, it, expect, beforeEach, mock } from "@unrift/core";

// Always start each test with a clean slate — `mock.restoreAll()` undoes
// any patched fetch from the previous test.
beforeEach(() => {
  mock.restoreAll();
});

describe("mock.fetch — string URL matcher", () => {
  it("returns the configured response for an exact URL match", async () => {
    mock.fetch("https://api.example.com/users", {
      status: 200,
      json: { users: [] },
    });

    const res = await fetch("https://api.example.com/users");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: [] });
  });

  it("auto-sets Content-Type to application/json for json shorthand", async () => {
    mock.fetch("https://x.test/", { json: { ok: true } });

    const res = await fetch("https://x.test/");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("preserves an explicit Content-Type when provided", async () => {
    mock.fetch("https://x.test/", {
      json: { ok: true },
      headers: { "Content-Type": "application/vnd.custom+json" },
    });

    const res = await fetch("https://x.test/");
    expect(res.headers.get("Content-Type")).toBe("application/vnd.custom+json");
  });

  it("defaults to status 200 when not specified", async () => {
    mock.fetch("https://x.test/", { body: "hi" });
    const res = await fetch("https://x.test/");
    expect(res.status).toBe(200);
  });

  it("supports custom status, statusText, and headers", async () => {
    mock.fetch("https://x.test/", {
      status: 418,
      statusText: "I'm a teapot",
      headers: { "X-Test": "yes" },
      body: "tea",
    });

    const res = await fetch("https://x.test/");
    expect(res.status).toBe(418);
    expect(res.headers.get("X-Test")).toBe("yes");
    expect(await res.text()).toBe("tea");
  });
});

describe("mock.fetch — regex and function matchers", () => {
  it("regex matcher matches by URL pattern", async () => {
    mock.fetch(/\/api\/users\/\d+/, { status: 200, json: { id: 1 } });

    const res = await fetch("https://x.test/api/users/42");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
  });

  it("function matcher receives the Request and decides", async () => {
    mock.fetch((req) => req.method === "POST", {
      status: 201,
      body: "created",
    });

    const res = await fetch("https://x.test/whatever", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("created");
  });

  it("function matcher returning false falls through to next handler", async () => {
    mock.fetch(() => false, { status: 500, body: "first" });
    mock.fetch(/\/api\//, { status: 200, body: "second" });

    const res = await fetch("https://x.test/api/foo");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("second");
  });
});

describe("mock.fetch — function response", () => {
  it("invokes a response factory with the Request", async () => {
    mock.fetch(/\//, async (req) => ({
      status: 200,
      json: { method: req.method, url: req.url },
    }));

    const res = await fetch("https://x.test/path", { method: "PUT" });
    const body = await res.json();
    expect(body.method).toBe("PUT");
    expect(body.url).toBe("https://x.test/path");
  });

  it("accepts a raw Response object", async () => {
    mock.fetch("https://x.test/", new Response("raw", { status: 202 }));

    const res = await fetch("https://x.test/");
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("raw");
  });
});

describe("mock.fetchOnce — single-use handlers", () => {
  it("consumes the handler after a single match", async () => {
    mock.fetchOnce("https://x.test/", { status: 500 });
    mock.fetch("https://x.test/", { status: 200 });

    const first = await fetch("https://x.test/");
    expect(first.status).toBe(500);

    const second = await fetch("https://x.test/");
    expect(second.status).toBe(200);
  });

  it("multiple fetchOnce handlers are consumed FIFO", async () => {
    mock.fetchOnce("https://x.test/", { status: 201 });
    mock.fetchOnce("https://x.test/", { status: 202 });
    mock.fetchOnce("https://x.test/", { status: 203 });

    const a = await fetch("https://x.test/");
    const b = await fetch("https://x.test/");
    const c = await fetch("https://x.test/");
    expect([a.status, b.status, c.status]).toEqual([201, 202, 203]);
  });
});

describe("mock.fetch — call recording", () => {
  it("records every Request that hits the patched fetch", async () => {
    mock.fetch(/\//, { status: 200 });

    await fetch("https://x.test/a");
    await fetch("https://x.test/b", { method: "POST" });

    expect(mock.fetch.calls).toHaveLength(2);
    expect(mock.fetch.calls[0].url).toBe("https://x.test/a");
    expect(mock.fetch.calls[1].method).toBe("POST");
  });

  it("records the request body so the test can inspect what was sent", async () => {
    mock.fetch(/\//, { status: 200 });

    await fetch("https://x.test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice" }),
    });

    const sent = await mock.fetch.calls[0].json();
    expect(sent).toEqual({ name: "alice" });
  });

  it("works with fetch(new Request(...))", async () => {
    mock.fetch(/\//, { status: 200 });

    const req = new Request("https://x.test/", { method: "DELETE" });
    await fetch(req);

    expect(mock.fetch.calls).toHaveLength(1);
    expect(mock.fetch.calls[0].method).toBe("DELETE");
  });
});

describe("mock.fetch — fall-through error", () => {
  it("throws with method and URL when no handler matches", async () => {
    // Registering a handler installs the patch; the unmatched request below
    // hits the fall-through path rather than the real network.
    mock.fetch("https://x.test/known", { status: 200 });

    let captured: Error | undefined;
    try {
      await fetch("https://x.test/missing", { method: "PATCH" });
    } catch (err) {
      captured = err as Error;
    }

    expect(captured).toBeInstanceOf(Error);
    expect(captured!.message).toContain("PATCH");
    expect(captured!.message).toContain("https://x.test/missing");
  });
});

describe("mock.fetch — matchers", () => {
  it("toHaveFetched passes for any call to the given URL string", async () => {
    mock.fetch(/\//, { status: 200 });

    await fetch("https://x.test/a");
    await fetch("https://x.test/b");

    expect(mock.fetch).toHaveFetched("https://x.test/a");
    expect(mock.fetch).toHaveFetched("https://x.test/b");
    expect(() =>
      expect(mock.fetch).toHaveFetched("https://x.test/c"),
    ).toThrow();
  });

  it("toHaveFetched accepts a regex matcher", async () => {
    mock.fetch(/\//, { status: 200 });

    await fetch("https://x.test/api/users/42");

    expect(mock.fetch).toHaveFetched(/\/api\/users\/\d+/);
    expect(() => expect(mock.fetch).toHaveFetched(/\/admin\//)).toThrow();
  });

  it("toHaveFetched accepts a predicate matcher", async () => {
    mock.fetch(/\//, { status: 200 });

    await fetch("https://x.test/", { method: "POST" });

    expect(mock.fetch).toHaveFetched(
      (req) => req.method === "POST",
    );
    expect(() =>
      expect(mock.fetch).toHaveFetched((req) => req.method === "DELETE"),
    ).toThrow();
  });

  it("toHaveFetchedTimes counts every call", async () => {
    mock.fetch(/\//, { status: 200 });

    await fetch("https://x.test/1");
    await fetch("https://x.test/2");
    await fetch("https://x.test/3");

    expect(mock.fetch).toHaveFetchedTimes(3);
    expect(() => expect(mock.fetch).toHaveFetchedTimes(2)).toThrow();
  });

  it("matcher rejects non-mock.fetch received values with a clear error", () => {
    expect(() => expect(() => 1).toHaveFetched("https://x.test/")).toThrow(
      "requires `mock.fetch`",
    );
  });
});

describe("mock.fetch — lifecycle", () => {
  it("reset() clears handlers and calls but keeps fetch patched", async () => {
    mock.fetch("https://x.test/", { status: 200 });
    await fetch("https://x.test/");

    mock.fetch.reset();

    expect(mock.fetch.calls).toEqual([]);
    // After reset, no handler matches — should fall through and throw.
    await expect(fetch("https://x.test/")).rejects.toBeInstanceOf(Error);
  });

  it("restore() unpatches global fetch", async () => {
    const real = globalThis.fetch;
    mock.fetch("https://x.test/", { status: 200 });
    expect(globalThis.fetch).not.toBe(real);

    mock.fetch.restore();

    expect(globalThis.fetch).toBe(real);
  });

  it("mock.restoreAll() also unpatches fetch", () => {
    const real = globalThis.fetch;
    mock.fetch("https://x.test/", { status: 200 });
    expect(globalThis.fetch).not.toBe(real);

    mock.restoreAll();

    expect(globalThis.fetch).toBe(real);
  });
});
