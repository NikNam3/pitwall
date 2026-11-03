/** Freezes `value` and everything reachable from it: the properties of objects and arrays, the entries of maps and sets. */
export const deepFreeze = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
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
