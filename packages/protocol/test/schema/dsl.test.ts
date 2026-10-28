import { describe, expect, expectTypeOf, it } from 'vitest';
import { array, chars, f32, f64, i16, i32, i8, sizeOf, splitTime, struct, u16, u32, u64, u8, type Infer } from '../../src/index.ts';

describe('sizeOf', () => {
  it.each([[u8, 1], [i8, 1], [u16, 2], [i16, 2], [u32, 4], [i32, 4], [u64, 8], [f32, 4], [f64, 8]] as const)(
    'primitive %o is %i bytes', (spec, size) => expect(sizeOf(spec)).toBe(size));
  it('arrays multiply, structs are packed (no padding)', () => {
    expect(sizeOf(array(u16, 4))).toBe(8);
    expect(sizeOf(struct({ a: u8, b: f32 }))).toBe(5);
    expect(sizeOf(array(array(u8, 22), 50))).toBe(1100);
  });
  it('nested structs, chars and splitTime', () => {
    expect(sizeOf(chars(32))).toBe(32);
    expect(sizeOf(splitTime())).toBe(3);
    expect(sizeOf(struct({ x: array(struct({ a: u8, b: u16 }), 3), name: chars(32), t: splitTime() }))).toBe(9 + 32 + 3);
    expect(sizeOf(struct({}))).toBe(0);
  });
});

describe('Infer', () => {
  it('maps specs to value types', () => {
    expectTypeOf<Infer<typeof u64>>().toEqualTypeOf<bigint>();
    expectTypeOf<Infer<typeof f32>>().toEqualTypeOf<number>();
    expectTypeOf<Infer<ReturnType<typeof chars>>>().toEqualTypeOf<string>();
    const s = struct({ uid: u64, laps: array(struct({ t: splitTime() }), 2) });
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<{ uid: bigint; laps: { t: number }[] }>();
  });
});
