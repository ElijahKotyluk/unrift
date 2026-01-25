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
