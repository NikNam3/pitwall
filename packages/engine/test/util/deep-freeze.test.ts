// `deepFreeze` (SP4.3c Task 25): freezes everything reachable; an object already frozen is skipped with its subtree
// (only deep freezes freeze objects, so it is frozen deeply), and no state lives longer than one call.
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../../src/util/deep-freeze.ts';

describe('deepFreeze', () => {
  it('freezes objects, arrays, map and set entries, and leaves typed arrays as they are', () => {
    const inner = { a: 1 };
    const value = { list: [inner], map: new Map([['k', { b: 2 }]]), set: new Set([{ c: 3 }]), typed: new Float64Array(2) };
    deepFreeze(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(inner)).toBe(true);
    expect(Object.isFrozen(value.map.get('k'))).toBe(true);
    expect([...value.set].every((v) => Object.isFrozen(v))).toBe(true);
    expect(Object.isFrozen(value.typed)).toBe(false);
  });

  it('ends on cycles', () => {
    const a: { self?: unknown } = {};
    a.self = a;
    deepFreeze(a);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('skips an object already frozen: a shared subtree of an earlier output is not walked again', () => {
    const shared = Object.freeze({ child: { x: 1 } });
    deepFreeze({ shared });
    expect(Object.isFrozen(shared.child)).toBe(false);
  });
});
