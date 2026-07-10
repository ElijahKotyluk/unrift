type Primitive = null | undefined | string | number | boolean | symbol | bigint;

export type TypedArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

export function isPrimitive(value: unknown): value is Primitive {
  const t = typeof value;

  return (
    value === null ||
    t === "string" ||
    t === "number" ||
    t === "boolean" ||
    t === "undefined" ||
    t === "symbol" ||
    t === "bigint"
  );
}

export function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function isTypedArray(value: unknown): value is TypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

/**
 * Returns true if the string looks like a glob pattern (contains * ? [ { }).
 * Patterns without these characters are treated as regex strings for backward compatibility.
 */
export function isGlobPattern(pattern: string): boolean {
  return /[*?[\]{]/.test(pattern);
}

/**
 * Converts a glob pattern to a RegExp.
 * Supports: ** (any path), * (any segment), ? (single char), {a,b} (alternation), [abc] (char class).
 */
export function globToRegex(glob: string): RegExp {
  let src = "";
  let i = 0;

  while (i < glob.length) {
    const c = glob[i];

    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** matches anything including path separators
        src += ".*";
        i += 2;
        // consume optional trailing slash so "fixtures/**" works
        if (glob[i] === "/") i++;
      } else {
        // * matches anything within a single path segment
        src += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      src += "[^/]";
      i++;
    } else if (c === "[") {
      // Pass character classes through as-is
      const close = glob.indexOf("]", i);
      if (close !== -1) {
        src += glob.slice(i, close + 1);
        i = close + 1;
      } else {
        src += "\\[";
        i++;
      }
    } else if (c === "{") {
      // {a,b,c} → (a|b|c)
      const close = glob.indexOf("}", i);
      if (close !== -1) {
        const parts = glob
          .slice(i + 1, close)
          .split(",")
          .map((p) => p.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
        src += `(${parts.join("|")})`;
        i = close + 1;
      } else {
        src += "\\{";
        i++;
      }
    } else if (/[.+^$|()\\]/.test(c)) {
      // Escape regex special characters
      src += "\\" + c;
      i++;
    } else {
      src += c;
      i++;
    }
  }

  return new RegExp(src);
}

export function safeRegExp(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex "${source}": ${msg}`);
  }
}

/**
 * Stateless RegExp match for user-supplied patterns.
 *
 * `RegExp.prototype.test` advances `lastIndex` for `/g` and `/y` regexes, so
 * reusing the same regex object across calls (a matcher tested against several
 * requests, or the same assertion run twice) can start mid-string and miss.
 * Resetting `lastIndex` first makes every test independent - "does this pattern
 * match the string" regardless of prior calls.
 */
export function regexTest(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  return re.test(value);
}

/**
 * SameValueZero-ish semantics:
 * - NaN equals NaN
 * - +0 and -0 are equal
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  return (
    typeof a === "number" &&
    typeof b === "number" &&
    Number.isNaN(a) &&
    Number.isNaN(b)
  );
}
