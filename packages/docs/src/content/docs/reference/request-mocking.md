---
title: Request Mocking
description: Stub global fetch with mock.fetch and mock.fetchOnce.
---

`mock.fetch` patches `globalThis.fetch` so tests can return canned responses without hitting the network. Handlers are matched against requests in registration order - the first match wins. Single-use handlers come from `mock.fetchOnce`.

```ts
import { mock, afterEach } from "unrift";

afterEach(() => mock.restoreAll());

it("returns a list of users", async () => {
  mock.fetch("https://api.example.com/users", {
    status: 200,
    json: { users: [{ id: 1, name: "alice" }] },
  });

  const res = await fetch("https://api.example.com/users");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ users: [{ id: 1, name: "alice" }] });
});
```

`globalThis.fetch` is only patched after the first handler is registered, so importing `mock` has zero runtime cost.

## Matchers

The first argument to `mock.fetch` is the matcher. Three forms:

| Form | Behavior |
| --- | --- |
| `string` | Exact URL match against `request.url` |
| `RegExp` | Tested against `request.url` |
| `(req: Request) => boolean \| Promise<boolean>` | Receives the full `Request`; useful for method / body / header matching |

```ts
mock.fetch("https://api.example.com/exact", { status: 200 });

mock.fetch(/\/api\/users\/\d+/, { status: 200, json: { id: 1 } });

mock.fetch(
  (req) => req.method === "POST" && req.url.endsWith("/users"),
  { status: 201, body: "created" },
);
```

## Response shorthand

The second argument can be:

- A plain object with `status`, `statusText`, `headers`, `body`, and/or `json`
- A real `Response` instance - passed through verbatim
- A function `(req: Request) => Response | object | Promise<...>` - invoked per request

When `json` is set, the body is `JSON.stringify`-ed and `Content-Type: application/json` is added automatically unless you've set it yourself.

```ts
mock.fetch("https://x.test/", {
  status: 418,
  statusText: "I'm a teapot",
  headers: { "X-Tea": "earl-grey" },
  body: "no coffee here",
});

// Echo handler
mock.fetch(/.*/, async (req) => ({
  status: 200,
  json: { method: req.method, url: req.url },
}));

// Raw Response passthrough
mock.fetch("https://x.test/raw", new Response("bytes", { status: 202 }));
```

## Single-use handlers

`mock.fetchOnce` and `mock.fetch.once` register a handler that is consumed after its first match. Useful for retries, queued responses, or "fail once, succeed second time" tests.

```ts
mock.fetchOnce("https://x.test/", { status: 500 });
mock.fetch("https://x.test/", { status: 200 });

const first = await fetch("https://x.test/");
expect(first.status).toBe(500);

const second = await fetch("https://x.test/");
expect(second.status).toBe(200);
```

Multiple `once` handlers form a FIFO queue:

```ts
mock.fetchOnce(url, { status: 201 });
mock.fetchOnce(url, { status: 202 });
mock.fetchOnce(url, { status: 203 });
// → consumed in that order; further calls fall through
```

## Inspecting calls

Every Request received by the patched fetch lands in `mock.fetch.calls`:

```ts
mock.fetch(/\//, { status: 200 });

await fetch("https://x.test/a");
await fetch("https://x.test/b", { method: "POST", body: '{"hi":1}' });

expect(mock.fetch.calls).toHaveLength(2);
expect(mock.fetch.calls[1].method).toBe("POST");
expect(await mock.fetch.calls[1].json()).toEqual({ hi: 1 });
```

The recorded values are real `Request` objects, so you can call `.json()`, `.text()`, `.headers.get(...)`, etc.

## Matchers

Two matchers operate on `mock.fetch` directly - pass `mock.fetch` as the `expect` value:

| Matcher | Pass condition |
| --- | --- |
| `.toHaveFetched(urlOrMatcher)` | Some call matched the URL string / regex / predicate |
| `.toHaveFetchedTimes(n)` | The patched fetch was called exactly `n` times |

```ts
mock.fetch(/\//, { status: 200 });

await fetch("https://api.example.com/users");
await fetch("https://api.example.com/admin", { method: "POST" });

expect(mock.fetch).toHaveFetched("https://api.example.com/users");
expect(mock.fetch).toHaveFetched(/\/admin/);
expect(mock.fetch).toHaveFetched((req) => req.method === "POST");
expect(mock.fetch).toHaveFetchedTimes(2);

expect(mock.fetch).not.toHaveFetched("https://api.example.com/nope");
```

If `received` isn't `mock.fetch`, the matchers throw a clear error.

## Fall-through

If no handler matches, the patched fetch throws:

```
No mock.fetch handler matched: PATCH https://x.test/unknown
```

This is intentional - tests should declare what they expect to send, and a missing handler is almost always a bug rather than something to fall through silently.

## Lifecycle

| Call | Effect |
| --- | --- |
| `mock.fetch.reset()` | Clear handlers and call history, keep fetch patched |
| `mock.fetch.restore()` | Unpatch global fetch and clear everything |
| `mock.restoreAll()` | Also unpatches fetch as part of bulk cleanup |

```ts
afterEach(() => {
  mock.restoreAll();
});
```

## Scope and limits

`mock.fetch` covers `globalThis.fetch` and `await fetch(new Request(...))`. It does **not** intercept:

- Direct calls into `node:http` / `node:https`
- `XMLHttpRequest`
- WebSocket / EventSource traffic

If you need full HTTP interception across libraries - including database clients, `axios` with the http agent, and the `node:http` low-level surface - use [MSW](https://mswjs.io/) alongside Unrift. `mock.fetch` is intentionally focused on the 90% case where the code under test calls `fetch` directly.
