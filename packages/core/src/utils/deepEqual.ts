import { isObjectLike, isPrimitive, sameValue } from "./helpers";
import { compareInternal } from "./compareEngine";

/**
 * Deep structural equality with:
 * - Value semantics for primitives (+ NaN equal, +0/-0 equal)
 * - Structural comparison for Arrays, Maps, Sets, TypedArrays, ArrayBuffer, DataView, Date, RegExp
 * - Prototype-sensitive object comparison
 * - Handles circular references
 */
export function deepEqual<T>(a: T, b: T): boolean {
  if (sameValue(a, b)) return true;

  // Fast-path for primitive inequality
  if (isPrimitive(a) || isPrimitive(b)) return false;

  if (!isObjectLike(a) || !isObjectLike(b)) return false;

  return compareInternal(
    a,
    b,
    {
      checkPrototype: true,
      treatSparseAsUndefined: false,
      bijectiveCycleCheck: false,
    },
    new WeakMap<object, object>(),
  );
}
