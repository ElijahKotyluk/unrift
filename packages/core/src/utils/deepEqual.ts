function isTypedArray(
  obj: unknown,
): obj is
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array {
  return ArrayBuffer.isView(obj) && !(obj instanceof DataView);
}

function isObject(obj: unknown): obj is Record<string | number, unknown> {
  return typeof obj === "object" && obj !== null;
}

function isIndexable(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a !== a && b !== b) return true; // NaN

  if (!isObject(a) || !isObject(b)) return false;

  const seen = new WeakMap<object, object>();
  const stack: Array<[unknown, unknown]> = [[a, b]];

  while (stack.length) {
    const [x, y] = stack.pop()!;

    if (x === y) continue;
    if (x !== x && y !== y) continue; // NaN

    if (!isObject(x) || !isObject(y)) return false;

    if (seen.has(x)) {
      if (seen.get(x) !== y) return false;
      continue;
    }
    seen.set(x, y);

    // Fast path for arrays
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);

      continue;
    }

    // Typed arrays
    if (isTypedArray(x) && isTypedArray(y)) {
      if (x.constructor !== y.constructor || x.length !== y.length)
        return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;

      continue;
    }

    // Dates
    if (x instanceof Date && y instanceof Date) {
      if (x.getTime() !== y.getTime()) return false;

      continue;
    }

    // RegExps
    if (x instanceof RegExp && y instanceof RegExp) {
      if (x.source !== y.source || x.flags !== y.flags) return false;

      continue;
    }

    // Sets
    if (x instanceof Set && y instanceof Set) {
      if (x.size !== y.size) return false;

      const yItems = Array.from(y);

      outer: for (const xv of x) {
        for (let i = 0; i < yItems.length; i++) {
          if (deepEqual(xv, yItems[i])) {
            yItems.splice(i, 1);
            continue outer;
          }
        }

        return false;
      }

      continue;
    }

    // Maps
    if (x instanceof Map && y instanceof Map) {
      if (x.size !== y.size) return false;

      const yEntries = Array.from(y.entries());

      outer: for (const [xk, xv] of x.entries()) {
        for (let i = 0; i < yEntries.length; i++) {
          const [yk, yv] = yEntries[i];

          if (deepEqual(xk, yk) && deepEqual(xv, yv)) {
            yEntries.splice(i, 1);
            continue outer;
          }
        }
        return false;
      }
      continue;
    }

    // Plain objects
    const xKeys = Object.keys(x);
    const yKeys = Object.keys(y);

    if (xKeys.length !== yKeys.length) return false;

    if (isIndexable(x) && isIndexable(y)) {
      for (let i = 0; i < xKeys.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(y, xKeys[i])) return false;
        stack.push([x[xKeys[i]], y[xKeys[i]]]);
      }
    }
  }

  return true;
}
