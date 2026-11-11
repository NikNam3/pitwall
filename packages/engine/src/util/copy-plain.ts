/**
 * A deep copy of plain data: objects with the plain prototype, arrays and primitives (the engine state is only that,
 * spec 6.4). About seven times faster than `structuredClone` on the state; anything else (a Map, a class instance)
 * is a bug and throws.
 */
export function copyPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copyPlain) as T;
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`copyPlain: not plain data: ${String(value)}`);
  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key in source) copy[key] = copyPlain(source[key]);
  return copy as T;
}

/** A `Known` (`{ known: true, value, at }` or `{ known: false, reason }`, domain `known.ts`). */
const isKnown = (o: Record<string, unknown>): boolean =>
  typeof o.known === 'boolean' && (o.known ? 'at' in o && 'value' in o : 'reason' in o);

/**
 * `copyPlain` that keeps every `Known` as it is instead of copying it: the engine never changes a `Known` once made
 * (step 1 and the recorders replace it; C8: each value carries its own time), so later frames cannot change it and a
 * snapshot that shares it stays the value it was taken as (C27, C33). Every other object and array is copied.
 */
export function copyPlainSharingKnown<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copyPlainSharingKnown) as T;
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`copyPlain: not plain data: ${String(value)}`);
  const source = value as Record<string, unknown>;
  if (isKnown(source)) return value;
  const copy: Record<string, unknown> = {};
  for (const key in source) copy[key] = copyPlainSharingKnown(source[key]);
  return copy as T;
}
