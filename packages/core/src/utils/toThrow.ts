import { isErrorLike, regexTest, safeString } from "./helpers.js";

export type ToThrowExpected =
  | undefined
  | string
  | RegExp
  | (new (...args: unknown[]) => Error)
  | { message?: string | RegExp; name?: string };

interface MatchResult {
  pass: boolean;
  message: () => string;
}

function isErrorConstructor(
  err: unknown,
): err is new (...args: unknown[]) => Error {
  return typeof err === "function";
}

function formatThrown(thrown: unknown): string {
  if (isErrorLike(thrown)) {
    const name = thrown.name || "Error";
    const msg = thrown.message ?? "";

    return msg ? `${name}: ${msg}` : name;
  }

  try {
    return typeof thrown === "string" ? thrown : JSON.stringify(thrown);
  } catch {
    return safeString(thrown);
  }
}

function formatExpected(expected: ToThrowExpected): string {
  return typeof expected === "string"
    ? `"${expected}"`
    : expected instanceof RegExp
      ? expected.toString()
      : isErrorConstructor(expected)
        ? expected.name || "[AnonymousErrorConstructor]"
        : JSON.stringify(expected, (_key, value) =>
            value instanceof RegExp ? value.toString() : value,
          );
}

function matchThrown(thrown: unknown, expected: ToThrowExpected): boolean {
  if (expected === undefined) return true;

  const msg = isErrorLike(thrown) ? thrown.message : safeString(thrown);

  // toThrow("substring")
  if (typeof expected === "string") {
    return msg.includes(expected);
  }

  // toThrow(/regex/)
  if (expected instanceof RegExp) {
    return regexTest(expected, msg);
  }

  // toThrow(ErrorClass)
  if (isErrorConstructor(expected)) {
    return thrown instanceof expected;
  }

  // toThrow({ name?, message? })
  if (expected && typeof expected === "object") {
    if (expected.name) {
      const thrownName = isErrorLike(thrown) ? thrown.name : undefined;

      if (thrownName !== expected.name) return false;
    }
    if (expected.message !== undefined) {
      if (typeof expected.message === "string") {
        if (!msg.includes(expected.message)) return false;
      } else {
        if (!regexTest(expected.message, msg)) return false;
      }
    }

    return true;
  }

  return false;
}

export function toThrow(
  received: unknown,
  expected?: ToThrowExpected,
  isNot = false,
): MatchResult {
  if (typeof received !== "function") {
    return {
      pass: false,
      message: () =>
        `toThrow() expects a function as the received value, but got ${typeof received}.`,
    };
  }

  let threw = false;
  let thrown: unknown;
  let result: unknown;

  try {
    result = (received as () => unknown)();
  } catch (e) {
    threw = true;
    thrown = e;
  }

  if (
    !threw &&
    result != null &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    // Suppress the unhandled rejection from the returned promise
    // Promise.resolve so plain thenables without .catch work too
    Promise.resolve(result).catch(() => {});

    return {
      pass: false,
      message: () =>
        "toThrow() received an async function. Use expect(fn).rejects.toThrow() for async errors.",
    };
  }

  const matched = threw && matchThrown(thrown, expected);
  const pass = isNot ? !matched : matched;

  return {
    pass,
    message: () => {
      const expectation = isNot ? "not to throw" : "to throw";
      if (!threw) {
        return `Expected function ${expectation}, but it did not throw.`;
      }

      const thrownStr = formatThrown(thrown);

      if (expected === undefined) {
        return `Expected function ${expectation}, but it threw: ${thrownStr}`;
      }

      return `Expected function ${expectation} ${formatExpected(expected)}, but it threw: ${thrownStr}`;
    },
  };
}

/**
 * toThrow under `.resolves` / `.rejects`. `received` is the settled value, not
 * a function. Same as Jest: it only counts as thrown if it's an Error.
 */
export function toThrowFromPromise(
  received: unknown,
  expected: ToThrowExpected,
  isNot: boolean,
  promise: "resolves" | "rejects",
): MatchResult {
  // Same as Jest: a non-Error function is called and treated like a sync
  // toThrow, so `resolves.toThrow()` works on a promise of a function.
  if (typeof received === "function" && !isErrorLike(received)) {
    return toThrow(received, expected, isNot);
  }

  const isError = isErrorLike(received);
  const matched = isError && matchThrown(received, expected);
  const pass = isNot ? !matched : matched;

  return {
    pass,
    message: () => {
      const verb = promise === "rejects" ? "reject" : "resolve";
      const past = promise === "rejects" ? "rejected" : "resolved";
      const target =
        expected === undefined ? "an Error" : formatExpected(expected);
      const got = isError
        ? formatThrown(received)
        : `a non-Error value: ${formatThrown(received)}`;

      return `Expected promise ${isNot ? "not " : ""}to ${verb} with ${target}, but it ${past} with ${got}`;
    },
  };
}
