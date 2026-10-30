import { SPLIT_TIME_MAX_MS, SPLIT_TIME_MIN_MS, sizeOf, type FieldSpec, type Infer, type Primitive, type StructSpec } from './dsl.ts';

const LITTLE_ENDIAN = true;
const MS_PER_MINUTE = 60_000;
const U16_RANGE = 65_536;
const U8_MAX = 255;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

type PrimitiveCodec = {
  read(view: DataView, offset: number): number | bigint;
  write(view: DataView, offset: number, value: never): void;
};

/** Integers are not range-checked: DataView semantics (wrap/truncate) apply. */
const PRIMITIVE_CODECS: Readonly<Record<Primitive, PrimitiveCodec>> = {
  u8: { read: (v, o) => v.getUint8(o), write: (v, o, x: number) => v.setUint8(o, x) },
  i8: { read: (v, o) => v.getInt8(o), write: (v, o, x: number) => v.setInt8(o, x) },
  u16: { read: (v, o) => v.getUint16(o, LITTLE_ENDIAN), write: (v, o, x: number) => v.setUint16(o, x, LITTLE_ENDIAN) },
  i16: { read: (v, o) => v.getInt16(o, LITTLE_ENDIAN), write: (v, o, x: number) => v.setInt16(o, x, LITTLE_ENDIAN) },
  u32: { read: (v, o) => v.getUint32(o, LITTLE_ENDIAN), write: (v, o, x: number) => v.setUint32(o, x, LITTLE_ENDIAN) },
  i32: { read: (v, o) => v.getInt32(o, LITTLE_ENDIAN), write: (v, o, x: number) => v.setInt32(o, x, LITTLE_ENDIAN) },
  u64: { read: (v, o) => v.getBigUint64(o, LITTLE_ENDIAN), write: (v, o, x: bigint) => v.setBigUint64(o, x, LITTLE_ENDIAN) },
  f32: { read: (v, o) => v.getFloat32(o, LITTLE_ENDIAN), write: (v, o, x: number) => v.setFloat32(o, x, LITTLE_ENDIAN) },
  f64: { read: (v, o) => v.getFloat64(o, LITTLE_ENDIAN), write: (v, o, x: number) => v.setFloat64(o, x, LITTLE_ENDIAN) },
};

type Reader = (view: DataView, offset: number) => unknown;
type Writer = (view: DataView, offset: number, value: unknown) => void;
type StructMember<T> = { readonly name: string; readonly offset: number; readonly codec: T };

/**
 * Specs are immutable, so each is compiled once into a closure that does no per-call schema walking
 * (field entries, offsets and strides are resolved up front), then reused for every packet.
 */
const readers = new WeakMap<FieldSpec, Reader>();
const writers = new WeakMap<FieldSpec, Writer>();

function cached<T>(cache: WeakMap<FieldSpec, T>, spec: FieldSpec, compile: (spec: FieldSpec) => T): T {
  let codec = cache.get(spec);
  if (codec === undefined) {
    codec = compile(spec);
    cache.set(spec, codec);
  }
  return codec;
}

/** The fields of a struct with their offsets relative to the struct start. */
function membersOf<T>(spec: StructSpec, codecOf: (field: FieldSpec) => T): StructMember<T>[] {
  let offset = 0;
  return Object.entries(spec.fields).map(([name, field]) => {
    const member = { name, offset, codec: codecOf(field) };
    offset += sizeOf(field);
    return member;
  });
}

/**
 * A struct reader that returns one object literal with every field in spec order, so all results of a
 * struct share one hidden class (a loop of keyed writes into `{}` is several times slower). The literal
 * is generated once per spec; field names go in through `JSON.stringify`, offsets are numbers.
 */
function compileStructReader(members: readonly StructMember<Reader>[]): Reader {
  const fields = members.map((member, i) => `${JSON.stringify(member.name)}: c[${i}](v, o + ${member.offset})`);
  const build = new Function('c', `return (v, o) => ({ ${fields.join(', ')} });`) as (codecs: readonly Reader[]) => Reader;
  return build(members.map((member) => member.codec));
}

function compileReader(spec: FieldSpec): Reader {
  switch (spec.kind) {
    case 'primitive':
      return PRIMITIVE_CODECS[spec.type].read;
    case 'array': {
      const readItem = readerOf(spec.item);
      const stride = sizeOf(spec.item);
      const length = spec.length;
      return (view, offset) => {
        const items = new Array<unknown>(length);
        for (let i = 0; i < length; i++) items[i] = readItem(view, offset + i * stride);
        return items;
      };
    }
    case 'struct':
      return compileStructReader(membersOf(spec, readerOf));
    case 'chars':
      return (view, offset) => {
        const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, spec.length);
        const nul = bytes.indexOf(0);
        return decoder.decode(nul === -1 ? bytes : bytes.subarray(0, nul));
      };
    case 'splitTime':
      return (view, offset) => {
        const msPart = view.getUint16(offset, LITTLE_ENDIAN);
        const minutes = view.getUint8(offset + 2);
        if (msPart < MS_PER_MINUTE) return minutes * MS_PER_MINUTE + msPart;
        return minutes === 0 ? msPart - U16_RANGE : -(minutes * MS_PER_MINUTE + msPart);
      };
  }
}

function compileWriter(spec: FieldSpec): Writer {
  switch (spec.kind) {
    case 'primitive':
      return PRIMITIVE_CODECS[spec.type].write as Writer;
    case 'array': {
      const writeItem = writerOf(spec.item);
      const stride = sizeOf(spec.item);
      return (view, offset, value) => {
        const items = value as unknown[];
        if (items.length !== spec.length) {
          throw new RangeError(`array expects ${spec.length} items, got ${items.length}`);
        }
        items.forEach((item, i) => writeItem(view, offset + i * stride, item));
      };
    }
    case 'struct': {
      const members = membersOf(spec, writerOf);
      return (view, offset, value) => {
        const record = value as Record<string, unknown>;
        for (const member of members) member.codec(view, offset + member.offset, record[member.name]);
      };
    }
    case 'chars':
      return (view, offset, value) => {
        const encoded = encoder.encode(value as string);
        if (encoded.length >= spec.length) {
          throw new RangeError(`chars(${spec.length}) needs ${encoded.length + 1} bytes including the NUL`);
        }
        const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, spec.length);
        bytes.fill(0);
        bytes.set(encoded);
      };
    case 'splitTime':
      return (view, offset, value) => {
        const ms = value as number;
        const [minutes, msPart] = splitTimeParts(ms);
        view.setUint16(offset, msPart, LITTLE_ENDIAN);
        view.setUint8(offset + 2, minutes);
      };
  }
}

/** The raw `[minutes, msPart]` of a split time: the inverse of the `splitTime` reader (see `splitTime` in dsl.ts). */
function splitTimeParts(ms: number): readonly [number, number] {
  if (Number.isInteger(ms)) {
    if (ms >= 0 && ms <= SPLIT_TIME_MAX_MS) return [Math.floor(ms / MS_PER_MINUTE), ms % MS_PER_MINUTE];
    if (ms < 0 && ms >= SPLIT_TIME_MIN_MS) return [0, ms + U16_RANGE];
    const minutes = Math.floor(-ms / MS_PER_MINUTE) - 1;
    const msPart = -ms - minutes * MS_PER_MINUTE;
    if (minutes >= 1 && minutes <= U8_MAX && msPart < U16_RANGE) return [minutes, msPart];
  }
  throw new RangeError(`splitTime must be an integer in ${SPLIT_TIME_MIN_MS}..${SPLIT_TIME_MAX_MS} ms or a garbage pair's value, got ${ms}`);
}

const readerOf = (spec: FieldSpec): Reader => cached(readers, spec, compileReader);
const writerOf = (spec: FieldSpec): Writer => cached(writers, spec, compileWriter);

/** Decodes the value of `spec` at `offset`. */
export function readField<S extends FieldSpec>(spec: S, view: DataView, offset: number): Infer<S>;
export function readField(spec: FieldSpec, view: DataView, offset: number): unknown {
  return readerOf(spec)(view, offset);
}

/** Encodes `value` as `spec` at `offset`. Throws `RangeError` for values the layout cannot hold. */
export function writeField<S extends FieldSpec>(spec: S, view: DataView, offset: number, value: Infer<S>): void;
export function writeField(spec: FieldSpec, view: DataView, offset: number, value: unknown): void {
  writerOf(spec)(view, offset, value);
}
