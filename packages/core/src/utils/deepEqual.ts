import {
  isObjectLike,
  isPrimitive,
  isTypedArray,
  sameValue,
  type TypedArray,
} from "./helpers";

type Pair = readonly [unknown, unknown];

function deepEqualInternal(
  left: unknown,
  right: unknown,
  leftToRightSeen: WeakMap<object, object>,
): boolean {
  const worklist: Pair[] = [[left, right]];

  while (worklist.length) {
    const [currentLeft, currentRight] = worklist.pop()!;

    if (sameValue(currentLeft, currentRight)) continue;

    // Types must match at this point
    if (typeof currentLeft !== typeof currentRight) return false;

    // Primitive mismatch - we already handled equality above
    if (isPrimitive(currentLeft) || isPrimitive(currentRight)) return false;

    // Functions, etc. – only ever equal by reference, which we've already checked
    if (!isObjectLike(currentLeft) || !isObjectLike(currentRight)) return false;

    const leftObj = currentLeft as object;
    const rightObj = currentRight as object;

    // Cycle detection: require consistent mapping for left-side objects
    const previouslyMappedRight = leftToRightSeen.get(leftObj);
    if (previouslyMappedRight !== undefined) {
      if (previouslyMappedRight !== rightObj) return false;

      continue;
    }

    leftToRightSeen.set(leftObj, rightObj);

    // Arrays - prototype-sensitive handled by prototype check later
    const leftIsArray = Array.isArray(currentLeft);
    const rightIsArray = Array.isArray(currentRight);

    if (leftIsArray || rightIsArray) {
      if (!leftIsArray || !rightIsArray) return false;

      const leftArr = currentLeft as unknown[];
      const rightArr = currentRight as unknown[];

      if (leftArr.length !== rightArr.length) return false;

      // Preserve sparseness by reading indexed values directly.
      for (let index = 0; index < leftArr.length; index++) {
        worklist.push([leftArr[index], rightArr[index]]);
      }

      continue;
    }

    // Typed arrays
    const leftIsTyped = isTypedArray(currentLeft);
    const rightIsTyped = isTypedArray(currentRight);

    if (leftIsTyped || rightIsTyped) {
      if (!leftIsTyped || !rightIsTyped) return false;

      const leftTA = currentLeft as TypedArray;
      const rightTA = currentRight as TypedArray;

      if (leftTA.constructor !== rightTA.constructor) return false;
      if (leftTA.length !== rightTA.length) return false;

      for (let index = 0; index < leftTA.length; index++) {
        if (!sameValue(leftTA[index], rightTA[index])) return false;
      }

      continue;
    }

    // ArrayBuffer
    const leftIsBuffer = currentLeft instanceof ArrayBuffer;
    const rightIsBuffer = currentRight instanceof ArrayBuffer;

    if (leftIsBuffer || rightIsBuffer) {
      if (!leftIsBuffer || !rightIsBuffer) return false;

      const leftBuf = currentLeft as ArrayBuffer;
      const rightBuf = currentRight as ArrayBuffer;

      if (leftBuf.byteLength !== rightBuf.byteLength) return false;

      const leftBytes = new Uint8Array(leftBuf);
      const rightBytes = new Uint8Array(rightBuf);

      for (let index = 0; index < leftBytes.length; index++) {
        if (leftBytes[index] !== rightBytes[index]) return false;
      }

      continue;
    }

    // DataView
    const leftIsView = currentLeft instanceof DataView;
    const rightIsView = currentRight instanceof DataView;

    if (leftIsView || rightIsView) {
      if (!leftIsView || !rightIsView) return false;

      const leftView = currentLeft as DataView;
      const rightView = currentRight as DataView;

      if (leftView.byteLength !== rightView.byteLength) return false;

      for (let offset = 0; offset < leftView.byteLength; offset++) {
        if (leftView.getUint8(offset) !== rightView.getUint8(offset))
          return false;
      }

      continue;
    }

    // Date
    const leftIsDate = currentLeft instanceof Date;
    const rightIsDate = currentRight instanceof Date;

    if (leftIsDate || rightIsDate) {
      if (!leftIsDate || !rightIsDate) return false;
      if ((currentLeft as Date).getTime() !== (currentRight as Date).getTime())
        return false;

      continue;
    }

    // RegExp
    const leftIsRegExp = currentLeft instanceof RegExp;
    const rightIsRegExp = currentRight instanceof RegExp;

    if (leftIsRegExp || rightIsRegExp) {
      if (!leftIsRegExp || !rightIsRegExp) return false;

      const leftRe = currentLeft as RegExp;
      const rightRe = currentRight as RegExp;

      if (leftRe.source !== rightRe.source) return false;
      if (leftRe.flags !== rightRe.flags) return false;

      continue;
    }

    // Set
    const leftIsSet = currentLeft instanceof Set;
    const rightIsSet = currentRight instanceof Set;

    if (leftIsSet || rightIsSet) {
      if (!leftIsSet || !rightIsSet) return false;

      const leftSet = currentLeft as Set<unknown>;
      const rightSet = currentRight as Set<unknown>;

      if (leftSet.size !== rightSet.size) return false;

      const unmatchedRightValues = new Set(rightSet);

      outer: for (const leftValue of leftSet) {
        for (const rightValue of unmatchedRightValues) {
          if (deepEqualInternal(leftValue, rightValue, leftToRightSeen)) {
            unmatchedRightValues.delete(rightValue);
            continue outer;
          }
        }
        return false;
      }

      continue;
    }

    // Map
    const leftIsMap = currentLeft instanceof Map;
    const rightIsMap = currentRight instanceof Map;

    if (leftIsMap || rightIsMap) {
      if (!leftIsMap || !rightIsMap) return false;

      const leftMap = currentLeft as Map<unknown, unknown>;
      const rightMap = currentRight as Map<unknown, unknown>;

      if (leftMap.size !== rightMap.size) return false;

      const unmatchedRightEntries = new Set(rightMap.entries());

      outer: for (const [leftKey, leftValue] of leftMap.entries()) {
        for (const candidate of unmatchedRightEntries) {
          const [rightKey, rightValue] = candidate;

          if (
            deepEqualInternal(leftKey, rightKey, leftToRightSeen) &&
            deepEqualInternal(leftValue, rightValue, leftToRightSeen)
          ) {
            unmatchedRightEntries.delete(candidate);
            continue outer;
          }
        }
        return false;
      }

      continue;
    }

    // Fallback: plain objects / custom class instances (prototype-sensitive)
    const leftProto = Object.getPrototypeOf(currentLeft);
    const rightProto = Object.getPrototypeOf(currentRight);

    if (leftProto !== rightProto) return false;

    const leftKeys = Object.keys(currentLeft as Record<string, unknown>);
    const rightKeys = Object.keys(currentRight as Record<string, unknown>);

    if (leftKeys.length !== rightKeys.length) return false;

    const leftRecord = currentLeft as Record<string, unknown>;
    const rightRecord = currentRight as Record<string, unknown>;

    for (let i = 0; i < leftKeys.length; i++) {
      const key = leftKeys[i];

      if (!Object.hasOwn(rightRecord, key)) return false;

      worklist.push([leftRecord[key], rightRecord[key]]);
    }
  }

  return true;
}

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

  return deepEqualInternal(a, b, new WeakMap<object, object>());
}
