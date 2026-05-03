/**
 * `mock.stub` - replace any property on any object (function or value),
 * with restoration tracked centrally so `mock.restoreAll()` can undo it.
 *
 * Use `spyOn` when you want a wrapped function spy. Use `stub` when you
 * want to swap in a fixed value or non-function replacement.
 */

import { activeRestorers } from "./spy";

/**
 * Replace `target[key]` with `value`. Returns a function that restores
 * the original property descriptor (or removes the key entirely if it
 * didn't exist before).
 *
 * The restorer is also registered with the global `mock.restoreAll()`
 * pool, so test cleanup can reset every stub at once.
 */
export function stub<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K],
): () => void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  const hadOwn = original !== undefined;

  if (original && original.configurable === false) {
    throw new Error(
      `mock.stub() cannot replace non-configurable property "${String(key)}"`,
    );
  }

  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: original?.enumerable ?? true,
  });

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;

    if (hadOwn && original) {
      Object.defineProperty(target, key, original);
    } else {
      // Property didn't exist on this object before, remove it to restore original behavior, including prototype inheritance.
      delete target[key];
    }

    activeRestorers.delete(restore);
  };

  activeRestorers.add(restore);
  return restore;
}

/**
 * Convenience wrapper: `mock.stub(globalThis, key, value)`. Useful for
 * swapping `fetch`, `crypto`, `console`, etc. during a test.
 */
export function mockGlobal<K extends string>(
  key: K,
  value: unknown,
): () => void {
  return stub(globalThis as unknown as Record<string, unknown>, key, value);
}
