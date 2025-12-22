import {
  isObjectLike,
  isPrimitive,
  isTypedArray,
  sameValue,
  type TypedArray,
} from "./helpers";

type WorkItem = readonly [unknown, unknown];

function looseEqualInternal(
  left: unknown,
  right: unknown,
  leftToRightSeen: WeakMap<object, object>,
  rightToLeftSeen: WeakMap<object, object>,
): boolean {
  const worklist: WorkItem[] = [[left, right]];

  while (worklist.length) {
    const [currentLeft, currentRight] = worklist.pop()!;

    if (sameValue(currentLeft, currentRight)) continue;

    if (typeof currentLeft !== typeof currentRight) return false;

    // At this point, primitives differ (sameValue already handled equality).
    if (isPrimitive(currentLeft) || isPrimitive(currentRight)) return false;

    if (!isObjectLike(currentLeft) || !isObjectLike(currentRight)) return false;

    const leftObj = currentLeft as object;
    const rightObj = currentRight as object;

    // Cycle / aliasing consistency (bijection-ish)
    const mappedRight = leftToRightSeen.get(leftObj);
    if (mappedRight !== undefined) {
      if (mappedRight !== rightObj) return false;
      continue;
    }
    const mappedLeft = rightToLeftSeen.get(rightObj);
    if (mappedLeft !== undefined) {
      if (mappedLeft !== leftObj) return false;
      continue;
    }
    leftToRightSeen.set(leftObj, rightObj);
    rightToLeftSeen.set(rightObj, leftObj);

    // Arrays: sparse holes treated as undefined
    const leftIsArray = Array.isArray(currentLeft);
    const rightIsArray = Array.isArray(currentRight);

    if (leftIsArray || rightIsArray) {
      if (!leftIsArray || !rightIsArray) return false;

      const leftArr = currentLeft as unknown[];
      const rightArr = currentRight as unknown[];

      if (leftArr.length !== rightArr.length) return false;

      for (let index = 0; index < leftArr.length; index++) {
        const leftValue = Object.hasOwn(leftArr, index)
          ? leftArr[index]
          : undefined;
        const rightValue = Object.hasOwn(rightArr, index)
          ? rightArr[index]
          : undefined;

        worklist.push([leftValue, rightValue]);
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

    // Set (order-insensitive)
    const leftIsSet = currentLeft instanceof Set;
    const rightIsSet = currentRight instanceof Set;

    if (leftIsSet || rightIsSet) {
      if (!leftIsSet || !rightIsSet) return false;

      const leftSet = currentLeft as Set<unknown>;
      const rightSet = currentRight as Set<unknown>;

      if (leftSet.size !== rightSet.size) return false;

      const remainingRight = new Set(rightSet);

      outer: for (const leftValue of leftSet) {
        for (const rightValue of remainingRight) {
          if (
            looseEqualInternal(
              leftValue,
              rightValue,
              leftToRightSeen,
              rightToLeftSeen,
            )
          ) {
            remainingRight.delete(rightValue);
            continue outer;
          }
        }
        return false;
      }
      continue;
    }

    // Map (order-insensitive by entries; keys compared via looseEqual)
    const leftIsMap = currentLeft instanceof Map;
    const rightIsMap = currentRight instanceof Map;

    if (leftIsMap || rightIsMap) {
      if (!leftIsMap || !rightIsMap) return false;

      const leftMap = currentLeft as Map<unknown, unknown>;
      const rightMap = currentRight as Map<unknown, unknown>;

      if (leftMap.size !== rightMap.size) return false;

      const remainingRightEntries = new Set(rightMap.entries());

      outer: for (const [leftKey, leftValue] of leftMap.entries()) {
        for (const candidate of remainingRightEntries) {
          const [rightKey, rightValue] = candidate;

          if (
            looseEqualInternal(
              leftKey,
              rightKey,
              leftToRightSeen,
              rightToLeftSeen,
            ) &&
            looseEqualInternal(
              leftValue,
              rightValue,
              leftToRightSeen,
              rightToLeftSeen,
            )
          ) {
            remainingRightEntries.delete(candidate);

            continue outer;
          }
        }
        return false;
      }
      continue;
    }

    // Fallback: compare by enumerable shape (prototype-insensitive).
    // Missing ≈ undefined via union-of-keys comparison.
    const leftKeys = Object.keys(currentLeft as Record<string, unknown>);
    const rightKeys = Object.keys(currentRight as Record<string, unknown>);
    const allKeys = new Set<string>([...leftKeys, ...rightKeys]);

    const leftRecord = currentLeft as Record<string, unknown>;
    const rightRecord = currentRight as Record<string, unknown>;

    for (const key of allKeys) {
      const leftHasKey = Object.hasOwn(leftRecord, key);
      const rightHasKey = Object.hasOwn(rightRecord, key);

      const leftValue = leftHasKey ? leftRecord[key] : undefined;
      const rightValue = rightHasKey ? rightRecord[key] : undefined;

      // If one side is missing and the other side is present-but-not-undefined, fail.
      if (leftHasKey !== rightHasKey) {
        if (leftValue !== undefined || rightValue !== undefined) return false;
      }

      worklist.push([leftValue, rightValue]);
    }
  }

  return true;
}

export function looseEqual<T>(left: T, right: T): boolean {
  if (sameValue(left, right)) return true;
  if (isPrimitive(left) || isPrimitive(right)) return false;
  if (!isObjectLike(left) || !isObjectLike(right)) return false;

  return looseEqualInternal(
    left,
    right,
    new WeakMap<object, object>(),
    new WeakMap<object, object>(),
  );
}
