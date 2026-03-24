import { isObjectLike, isPrimitive, sameValue } from "./helpers";
import { compareInternal } from "./compareEngine";

/**
 * Loose structural equality with:
 * - Value semantics for primitives (+ NaN equal, +0/-0 equal)
 * - Prototype-insensitive object comparison
 * - Sparse array holes treated as undefined
 * - Missing keys ≈ undefined (union-of-keys approach)
 * - Bidirectional cycle tracking
 * - Order-insensitive Set/Map comparison
 */
export function looseEqual<T>(left: T, right: T): boolean {
  if (sameValue(left, right)) return true;
  if (isPrimitive(left) || isPrimitive(right)) return false;
  if (!isObjectLike(left) || !isObjectLike(right)) return false;

  return compareInternal(
    left,
    right,
    {
      checkPrototype: false,
      treatSparseAsUndefined: true,
      bijectiveCycleCheck: true,
    },
    new WeakMap<object, object>(),
    new WeakMap<object, object>(),
  );
}
