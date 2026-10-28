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
