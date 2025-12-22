type ToThrowExpected =
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
  if (thrown instanceof Error) {
    const name = thrown.name || "Error";
    const msg = thrown.message ?? "";

    return msg ? `${name}: ${msg}` : name;
  }

  try {
    return typeof thrown === "string" ? thrown : JSON.stringify(thrown);
  } catch {
    return String(thrown);
  }
}

function matchThrown(thrown: unknown, expected: ToThrowExpected): boolean {
  if (expected === undefined) return true;

  const msg = thrown instanceof Error ? thrown.message : String(thrown);

  // toThrow("substring")
  if (typeof expected === "string") {
    return msg.includes(expected);
  }

  // toThrow(/regex/)
  if (expected instanceof RegExp) {
    return expected.test(msg);
  }

  // toThrow(ErrorClass)
  if (isErrorConstructor(expected)) {
    return thrown instanceof expected;
  }

  // toThrow({ name?, message? })
  if (expected && typeof expected === "object") {
    if (expected.name) {
      const thrownName = thrown instanceof Error ? thrown.name : undefined;

      if (thrownName !== expected.name) return false;
    }
    if (expected.message !== undefined) {
      if (typeof expected.message === "string") {
        if (!msg.includes(expected.message)) return false;
      } else {
        if (!expected.message.test(msg)) return false;
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

  try {
    (received as () => void)();
  } catch (e) {
    threw = true;
    thrown = e;
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

      const expectedStr =
        typeof expected === "string"
          ? `"${expected}"`
          : expected instanceof RegExp
            ? expected.toString()
            : isErrorConstructor(expected)
              ? expected.name || "[AnonymousErrorConstructor]"
              : JSON.stringify(expected);

      return `Expected function ${expectation} ${expectedStr}, but it threw: ${thrownStr}`;
    },
  };
}
