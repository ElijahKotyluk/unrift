/**
 * `mock.fetch` - stub `globalThis.fetch` for HTTP testing.
 *
 * Handlers are matched against requests in registration order; the first
 * matching handler wins. `mock.fetchOnce()` registers a single-use handler
 * that's consumed after its first match.
 *
 * Restoration:
 *   - `mock.fetch.restore()` un-patches global fetch and clears handlers
 *   - `mock.restoreAll()` does the same as part of bulk cleanup
 */

import { activeRestorers } from "./spy";

/** Brand applied to `mock.fetch` so matchers can verify their received value. */
export const FETCH_MOCK_BRAND: unique symbol = Symbol.for("unrift.fetchMock");

/**
 * Derive WebFetch helper types from the runtime constructors so we don't
 * have to widen the project's `lib` config to include `dom` types. These
 * match what the platform actually accepts.
 */
type HeadersInitLike = ConstructorParameters<typeof Headers>[0];
type BodyInitLike = ConstructorParameters<typeof Response>[0];
type RequestInfoLike = ConstructorParameters<typeof Request>[0];

/** What can be passed as the first argument to `mock.fetch(matcher, ...)`. */
export type FetchMatcher =
  | string
  | RegExp
  | ((req: Request) => boolean | Promise<boolean>);

// Convenience response shape; `json` is auto-stringified.
export interface MockResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInitLike;
  body?: BodyInitLike | null;
  json?: unknown; // stringified; sets Content-Type to application/json if missing.
}

// Anything `mock.fetch(..., response)` accepts as the response.
export type MockFetchResponse =
  | Response
  | MockResponseInit
  | ((
      req: Request,
    ) => Response | MockResponseInit | Promise<Response | MockResponseInit>);

interface Handler {
  matcher: FetchMatcher;
  response: MockFetchResponse;
  once: boolean;
  consumed: boolean;
}

const handlers: Handler[] = [];
const calls: Request[] = [];
let originalFetch: typeof globalThis.fetch | undefined;
// Whether globalThis had a `fetch` at install time. If it didn't (older Node,
// custom runtimes), restore must DELETE our patch rather than leave it — the
// original state was "fetch is absent", and `originalFetch` being undefined
// must not be mistaken for "nothing to restore".
let fetchWasDefined = false;
let installed = false;

function urlOf(req: Request): string {
  return req.url;
}

async function matches(handler: Handler, req: Request): Promise<boolean> {
  if (handler.consumed) return false;
  const m = handler.matcher;
  if (typeof m === "string") return urlOf(req) === m;
  if (m instanceof RegExp) return m.test(urlOf(req));
  if (typeof m === "function") return Boolean(await m(req));
  return false;
}

async function buildResponse(
  spec: MockFetchResponse,
  req: Request,
): Promise<Response> {
  let resolved: Response | MockResponseInit;

  if (typeof spec === "function") {
    resolved = await spec(req);
  } else {
    resolved = spec;
  }

  if (resolved instanceof Response) return resolved;

  const init = resolved;
  let body: BodyInitLike | null | undefined = init.body;
  const headers = new Headers(init.headers);

  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  return new Response(body ?? null, {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers,
  });
}

function patchedFetch(
  input: RequestInfoLike,
  init?: RequestInit,
): Promise<Response> {
  /**
   * Normalize all call shapes - `fetch(url)`, `fetch(url, init)`,
   * `fetch(new Request(...))`, `fetch(new Request(...), init)` into a
   * single Request object that handlers can introspect.
   */
  const req =
    input instanceof Request
      ? new Request(input, init)
      : new Request(input, init);

  calls.push(req);

  return (async () => {
    for (const handler of handlers) {
      if (await matches(handler, req)) {
        if (handler.once) handler.consumed = true;
        return buildResponse(handler.response, req);
      }
    }

    throw new Error(`No mock.fetch handler matched: ${req.method} ${req.url}`);
  })();
}

function install(): void {
  if (installed) return;

  installed = true;
  // `in` checks presence without triggering Node's lazy fetch getter.
  fetchWasDefined = "fetch" in globalThis;
  originalFetch = globalThis.fetch;
  globalThis.fetch = patchedFetch as typeof globalThis.fetch;

  activeRestorers.add(restoreFetch);
}

function restoreFetch(): void {
  if (!installed) return;

  installed = false;
  if (fetchWasDefined) {
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  } else {
    // fetch didn't exist before we patched it — remove our patch so the
    // environment reads `undefined` again, rather than leaking the stale mock.
    delete (globalThis as { fetch?: unknown }).fetch;
  }
  originalFetch = undefined;
  fetchWasDefined = false;
  handlers.length = 0;
  calls.length = 0;

  activeRestorers.delete(restoreFetch);
}

function register(
  matcher: FetchMatcher,
  response: MockFetchResponse,
  once: boolean,
): void {
  install();
  handlers.push({ matcher, response, once, consumed: false });
}

/**
 * Public surface for `mock.fetch`. Callable to register a handler, with
 * attached helpers for inspection and cleanup.
 */
export interface MockFetch {
  // Register a permanent handler
  (matcher: FetchMatcher, response: MockFetchResponse): void;
  // Register a single-use handler - consumed on first match.
  once(matcher: FetchMatcher, response: MockFetchResponse): void;
  // Every Request received by the patched fetch, in order.
  readonly calls: Request[];
  // Clear handlers and call history without unpatching.
  reset(): void;
  // Unpatch global fetch, clear handlers, clear calls.
  restore(): void;
  // Brand for matcher type-checking.
  readonly [FETCH_MOCK_BRAND]: true;
}

// Type guard used by toHaveFetched / toHaveFetchedTimes matchers.
export function isFetchMock(value: unknown): value is MockFetch {
  return (
    typeof value === "function" &&
    (value as { [FETCH_MOCK_BRAND]?: true })[FETCH_MOCK_BRAND] === true
  );
}

const mockFetchImpl = ((matcher: FetchMatcher, response: MockFetchResponse) =>
  register(matcher, response, false)) as MockFetch;

mockFetchImpl.once = (matcher, response) => register(matcher, response, true);
mockFetchImpl.reset = () => {
  handlers.length = 0;
  calls.length = 0;
};
mockFetchImpl.restore = restoreFetch;

Object.defineProperty(mockFetchImpl, "calls", {
  get: () => calls,
  enumerable: true,
  configurable: false,
});

Object.defineProperty(mockFetchImpl, FETCH_MOCK_BRAND, {
  value: true,
  enumerable: false,
  configurable: false,
  writable: false,
});

export const mockFetch: MockFetch = mockFetchImpl;

export function mockFetchOnce(
  matcher: FetchMatcher,
  response: MockFetchResponse,
): void {
  mockFetch.once(matcher, response);
}
