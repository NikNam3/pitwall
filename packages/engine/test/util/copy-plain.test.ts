import { describe, expect, it } from 'vitest';
import { copyPlain } from '../../src/util/copy-plain.ts';

describe('copyPlain', () => {
  it('copies plain data deeply, keeping undefined fields, undefined entries and bigints', () => {
    const value = { a: [1, { b: 'x' }, undefined], c: { d: undefined, e: 5n }, f: null };
    const copy = copyPlain(value);
    expect(copy).toStrictEqual(value);
    expect([copy.a === value.a, copy.a[1] === value.a[1], copy.c === value.c]).toEqual([false, false, false]);
    expect(Object.keys(copy.c)).toEqual(['d', 'e']);
  });

  it('throws on data that is not plain', () => {
    expect(() => copyPlain({ m: new Map() })).toThrow(TypeError);
    expect(() => copyPlain([new Date(0)])).toThrow(TypeError);
  });
});
