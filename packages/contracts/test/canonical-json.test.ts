import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/index.ts';

/** The same value with every object's keys inserted in reverse order. */
const reversedKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversedKeys(v)]));
  }
  return value;
};

describe('canonicalJson', () => {
  it('writes object keys sorted, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } })).toBe('{"a":{"c":[{"e":4,"f":3}],"d":2},"b":1}');
  });

  it('sorts keys by code unit, so upper case comes before lower case', () => {
    expect(canonicalJson({ a: 1, B: 2, _: 3 })).toBe('{"B":2,"_":3,"a":1}');
  });

  it('keeps arrays in their order', () => {
    expect(canonicalJson([2, 1, 3])).toBe('[2,1,3]');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('gives the same text for equal values whatever the key insertion order', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(canonicalJson(reversedKeys(value))).toBe(canonicalJson(value));
      }),
    );
  });

  it('gives JSON that parses back to the value JSON keeps', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });

  it('writes -0 as 0, as JSON does, so the two are one key', () => {
    expect(canonicalJson([-0, { x: -0 }])).toBe('[0,{"x":0}]');
    expect(canonicalJson(-0)).toBe(canonicalJson(0));
  });

  it('leaves out keys whose value is undefined, as JSON does', () => {
    expect(canonicalJson({ carId: 3, feedId: undefined })).toBe(canonicalJson({ carId: 3 }));
  });

  it('writes null and primitives as JSON', () => {
    expect([null, 'laps', 7, true].map(canonicalJson)).toEqual(['null', '"laps"', '7', 'true']);
  });
});
