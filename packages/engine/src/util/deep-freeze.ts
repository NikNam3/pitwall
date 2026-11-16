/**
 * Freezes `value` and everything reachable from it: the properties of objects and arrays, the entries of maps and sets.
 * An object already frozen is skipped with everything below it: only deep freezes freeze the objects it meets (outputs
 * here, log entries in `log.ts`; the few shallow `Object.freeze` constants hold primitives only), so a subtree an earlier
 * output shares is not walked again, and no set lives longer than one call (SP4.3c Task 25: a run-long set grew without
 * bound and made GC stall).
 */
export const deepFreeze = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value) || Object.isFrozen(value)) return;
  seen.add(value);
  // A typed array cannot be frozen (its elements are not configurable): left as it is (SP4.3b Task 21).
  if (ArrayBuffer.isView(value)) return;
  if (value instanceof Map) {
    for (const [k, v] of value) {
      deepFreeze(k, seen);
      deepFreeze(v, seen);
    }
  } else if (value instanceof Set) {
    for (const v of value) deepFreeze(v, seen);
  }
  for (const v of Object.values(value)) deepFreeze(v, seen);
  Object.freeze(value);
};
