/**
 * Schema DSL: declarative, packed (no padding) little-endian binary layouts.
 * A schema is a plain frozen object; `Infer<S>` gives the decoded value type and
 * `readField`/`writeField` (codec.ts) walk it. Walkers switch on `kind`.
 */

export type Primitive = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'f32' | 'f64';

export type PrimitiveSpec<P extends Primitive = Primitive> = { readonly kind: 'primitive'; readonly type: P };
// Interfaces (not type aliases) so that FieldSpec can refer to itself through them.
export interface ArraySpec<S extends FieldSpec = FieldSpec> {
  readonly kind: 'array';
  readonly item: S;
  readonly length: number;
}
export interface StructSpec<F extends Record<string, FieldSpec> = Record<string, FieldSpec>> {
  readonly kind: 'struct';
  readonly fields: F;
}
export type CharsSpec = { readonly kind: 'chars'; readonly length: number };
export type SplitTimeSpec = { readonly kind: 'splitTime' };

export type FieldSpec = PrimitiveSpec | ArraySpec | StructSpec | CharsSpec | SplitTimeSpec;

/** Decoded value type of a spec: `u64` is `bigint`, other primitives `number`, `splitTime` is ms. */
export type Infer<S extends FieldSpec> =
  S extends PrimitiveSpec<infer P> ? (P extends 'u64' ? bigint : number)
  : S extends ArraySpec<infer Item> ? Infer<Item>[]
  : S extends StructSpec<infer F> ? { [K in keyof F]: Infer<F[K]> }
  : S extends CharsSpec ? string
  : S extends SplitTimeSpec ? number
  : never;

const primitive = <P extends Primitive>(type: P): PrimitiveSpec<P> => Object.freeze({ kind: 'primitive', type });

export const u8 = primitive('u8');
export const i8 = primitive('i8');
export const u16 = primitive('u16');
export const i16 = primitive('i16');
export const u32 = primitive('u32');
export const i32 = primitive('i32');
export const u64 = primitive('u64');
export const f32 = primitive('f32');
export const f64 = primitive('f64');

export const array = <S extends FieldSpec>(item: S, length: number): ArraySpec<S> =>
  Object.freeze({ kind: 'array', item, length });

/** Fixed-size UTF-8 string, NUL terminated and NUL padded (the C `char name[length]`). */
export const chars = (length: number): CharsSpec => Object.freeze({ kind: 'chars', length });

/**
 * A lap or sector time packed as `u16 msPart` + `u8 minutes` (3 bytes), decoded to whole ms.
 * Encoding: `msPart = ms % 60000`, `minutes = floor(ms / 60000)`.
 * Negative deltas: the game writes them as `msPart = ms + 65536` with `minutes = 0`. A real
 * ms part is always below 60000, so `minutes === 0 && msPart >= 60000` reads as `msPart - 65536`.
 */
export const splitTime = (): SplitTimeSpec => Object.freeze({ kind: 'splitTime' });

export const struct = <F extends Record<string, FieldSpec>>(fields: F): StructSpec<F> =>
  Object.freeze({ kind: 'struct', fields });

/** Largest encodable split time: 255 min 59.999 s. */
export const SPLIT_TIME_MAX_MS = 255 * 60_000 + 59_999;
/** Smallest encodable split time: the negative delta written as `msPart = 60000`, minutes 0. */
export const SPLIT_TIME_MIN_MS = 60_000 - 65_536;
export const SPLIT_TIME_BYTES = 3;

const PRIMITIVE_BYTES: Readonly<Record<Primitive, number>> = {
  u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, f32: 4, f64: 8,
};

/** Specs are immutable, so the size of a composite spec is computed once and remembered. */
const compositeSizes = new WeakMap<FieldSpec, number>();

/** Packed size in bytes. */
export function sizeOf(spec: FieldSpec): number {
  switch (spec.kind) {
    case 'primitive': return PRIMITIVE_BYTES[spec.type];
    case 'array': return memoised(spec, () => spec.length * sizeOf(spec.item));
    case 'struct': return memoised(spec, () => Object.values(spec.fields).reduce((total, field) => total + sizeOf(field), 0));
    case 'chars': return spec.length;
    case 'splitTime': return SPLIT_TIME_BYTES;
  }
}

function memoised(spec: FieldSpec, compute: () => number): number {
  let size = compositeSizes.get(spec);
  if (size === undefined) {
    size = compute();
    compositeSizes.set(spec, size);
  }
  return size;
}
