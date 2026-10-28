import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { array, chars, f32, f64, i16, i32, i8, readField, splitTime, struct, u16, u32, u64, u8, writeField, type FieldSpec } from '../../src/index.ts';

/** Writes at offset 3 into a buffer pre-filled with 0xAA; returns the bytes written. */
function written<S extends FieldSpec>(spec: S, value: unknown, size: number): number[] {
  const buf = new Uint8Array(3 + size + 2).fill(0xaa);
  writeField(spec, new DataView(buf.buffer), 3, value as never);
  expect([...buf.subarray(0, 3), ...buf.subarray(3 + size)]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa]); // no spill
  return [...buf.subarray(3, 3 + size)];
}
const read = <S extends FieldSpec>(spec: S, bytes: number[]) => readField(spec, new DataView(new Uint8Array([0, 0, 0, ...bytes]).buffer), 3);

describe('primitives are little-endian', () => {
  it.each([
    ['u8', u8, 255, [0xff]], ['i8', i8, -128, [0x80]],
    ['u16', u16, 0x1234, [0x34, 0x12]], ['i16', i16, -2, [0xfe, 0xff]],
    ['u32', u32, 0x01020304, [4, 3, 2, 1]], ['i32', i32, -1, [0xff, 0xff, 0xff, 0xff]],
    ['f32', f32, 1.5, [0, 0, 0xc0, 0x3f]], ['f64', f64, 1.5, [0, 0, 0, 0, 0, 0, 0xf8, 0x3f]],
    ['u64', u64, 0x0102030405060708n, [8, 7, 6, 5, 4, 3, 2, 1]], ['u64 max', u64, 2n ** 64n - 1n, Array(8).fill(0xff)],
  ] as const)('%s', (_n, spec, value, bytes) => {
    expect(written(spec, value, bytes.length)).toEqual(bytes);
    expect(read(spec, [...bytes])).toEqual(value);
  });
  it('u64 decodes to bigint', () => expect(typeof read(u64, [1, 0, 0, 0, 0, 0, 0, 0])).toBe('bigint'));
  it('round-trips any value of every primitive', () => {
    const cases: Array<[FieldSpec, fc.Arbitrary<unknown>]> = [
      [u8, fc.integer({ min: 0, max: 255 })], [i8, fc.integer({ min: -128, max: 127 })],
      [u16, fc.integer({ min: 0, max: 65535 })], [i16, fc.integer({ min: -32768, max: 32767 })],
      [u32, fc.integer({ min: 0, max: 2 ** 32 - 1 })], [i32, fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 })],
      [u64, fc.bigInt({ min: 0n, max: 2n ** 64n - 1n })], [f32, fc.float().map(Math.fround)], [f64, fc.double()],
    ];
    for (const [spec, arb] of cases) {
      fc.assert(fc.property(arb, (v) => {
        const view = new DataView(new ArrayBuffer(16));
        writeField(spec, view, 5, v as never);
        expect(readField(spec, view, 5)).toEqual(v);
      }));
    }
  });
});

describe('splitTime', () => {
  it('83_456 ms = 1 min 23.456 s -> msPart 23456 (u16 LE), minutes 1', () => {
    expect(written(splitTime(), 83_456, 3)).toEqual([0xa0, 0x5b, 0x01]);
    expect(read(splitTime(), [0xa0, 0x5b, 0x01])).toBe(83_456);
  });
  it('minutes 0 with msPart >= 60000 is a negative delta (u16 wrap), seen in raceSingapore', () => {
    expect(read(splitTime(), [0xef, 0xff, 0x00])).toBe(-17);       // 65519 - 65536
    expect(written(splitTime(), -17, 3)).toEqual([0xef, 0xff, 0x00]);
    expect(read(splitTime(), [0x60, 0xea, 0x00])).toBe(-5_536);    // msPart 60000
  });
  it('round-trips SPLIT_TIME_MIN_MS..SPLIT_TIME_MAX_MS', () => fc.assert(fc.property(fc.integer({ min: -5_536, max: 15_359_999 }), (ms) => {
    const view = new DataView(new ArrayBuffer(3));
    writeField(splitTime(), view, 0, ms);
    expect(readField(splitTime(), view, 0)).toBe(ms);
  })));
  it('throws RangeError for values below SPLIT_TIME_MIN_MS, fractional or too large', () => {
    for (const bad of [-5_537, 1.5, 15_360_000]) expect(() => written(splitTime(), bad, 3)).toThrow(RangeError);
  });
});

describe('chars', () => {
  it('writes UTF-8 then NUL padding', () => {
    expect(written(chars(8), 'Max', 8)).toEqual([77, 97, 120, 0, 0, 0, 0, 0]);
    expect(written(chars(8), 'Pérez', 8)).toEqual([0x50, 0xc3, 0xa9, 0x72, 0x65, 0x7a, 0, 0]);
  });
  it('reads up to the first NUL and ignores bytes after it', () => {
    expect(read(chars(8), [0x50, 0, 0x72, 0x65, 0, 0, 0, 0])).toBe('P');
    expect(read(chars(8), [0x50, 0xc3, 0xa9, 0x72, 0x65, 0x7a, 0, 0])).toBe('Pérez');
  });
  it('reads the full field when there is no NUL', () => expect(read(chars(4), [65, 66, 67, 68])).toBe('ABCD'));
  it('throws RangeError when the UTF-8 bytes do not leave room for the NUL', () => {
    expect(() => written(chars(4), 'ABCD', 4)).toThrow(RangeError);
    expect(() => written(chars(4), 'ABé', 4)).toThrow(RangeError);
  });
});

describe('structs and arrays', () => {
  it('writes fields in declaration order', () => {
    expect(written(struct({ b: u16, a: u8 }), { b: 2, a: 1 }, 3)).toEqual([2, 0, 1]);
    expect(read(struct({ b: u16, a: u8 }), [2, 0, 1])).toEqual({ b: 2, a: 1 });
  });
  it('arrays of structs', () => {
    const spec = array(struct({ x: i8, y: u8 }), 2);
    expect(written(spec, [{ x: -1, y: 2 }, { x: 3, y: 4 }], 4)).toEqual([0xff, 2, 3, 4]);
    expect(read(spec, [0xff, 2, 3, 4])).toEqual([{ x: -1, y: 2 }, { x: 3, y: 4 }]);
  });
  it('throws RangeError when an array value has the wrong length', () => {
    expect(() => written(array(u8, 3), [1, 2], 3)).toThrow(RangeError);
  });
});
