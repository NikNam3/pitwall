import { SPLIT_TIME_MAX_MS, SPLIT_TIME_MIN_MS, sizeOf, type FieldSpec, type Infer, type Primitive } from './dsl.ts';

const LITTLE_ENDIAN = true;
const MS_PER_MINUTE = 60_000;
const U16_RANGE = 65_536;

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

/** Decodes the value of `spec` at `offset`. */
export function readField<S extends FieldSpec>(spec: S, view: DataView, offset: number): Infer<S>;
export function readField(spec: FieldSpec, view: DataView, offset: number): unknown {
  switch (spec.kind) {
    case 'primitive':
      return PRIMITIVE_CODECS[spec.type].read(view, offset);
    case 'array': {
      const stride = sizeOf(spec.item);
      return Array.from({ length: spec.length }, (_, i) => readField(spec.item, view, offset + i * stride));
    }
    case 'struct': {
      const result: Record<string, unknown> = {};
      let at = offset;
      for (const [name, field] of Object.entries(spec.fields)) {
        result[name] = readField(field, view, at);
        at += sizeOf(field);
      }
      return result;
    }
    case 'chars': {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, spec.length);
      const nul = bytes.indexOf(0);
      return decoder.decode(nul === -1 ? bytes : bytes.subarray(0, nul));
    }
    case 'splitTime': {
      const msPart = view.getUint16(offset, LITTLE_ENDIAN);
      const minutes = view.getUint8(offset + 2);
      return minutes === 0 && msPart >= MS_PER_MINUTE ? msPart - U16_RANGE : minutes * MS_PER_MINUTE + msPart;
    }
  }
}

/** Encodes `value` as `spec` at `offset`. Throws `RangeError` for values the layout cannot hold. */
export function writeField<S extends FieldSpec>(spec: S, view: DataView, offset: number, value: Infer<S>): void;
export function writeField(spec: FieldSpec, view: DataView, offset: number, value: unknown): void {
  switch (spec.kind) {
    case 'primitive':
      PRIMITIVE_CODECS[spec.type].write(view, offset, value as never);
      return;
    case 'array': {
      const items = value as unknown[];
      if (items.length !== spec.length) {
        throw new RangeError(`array expects ${spec.length} items, got ${items.length}`);
      }
      const stride = sizeOf(spec.item);
      items.forEach((item, i) => writeField(spec.item, view, offset + i * stride, item as never));
      return;
    }
    case 'struct': {
      const record = value as Record<string, unknown>;
      let at = offset;
      for (const [name, field] of Object.entries(spec.fields)) {
        writeField(field, view, at, record[name] as never);
        at += sizeOf(field);
      }
      return;
    }
    case 'chars': {
      const encoded = encoder.encode(value as string);
      if (encoded.length >= spec.length) {
        throw new RangeError(`chars(${spec.length}) needs ${encoded.length + 1} bytes including the NUL`);
      }
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, spec.length);
      bytes.fill(0);
      bytes.set(encoded);
      return;
    }
    case 'splitTime': {
      const ms = value as number;
      if (!Number.isInteger(ms) || ms < SPLIT_TIME_MIN_MS || ms > SPLIT_TIME_MAX_MS) {
        throw new RangeError(`splitTime must be an integer in ${SPLIT_TIME_MIN_MS}..${SPLIT_TIME_MAX_MS} ms, got ${ms}`);
      }
      const negative = ms < 0;
      view.setUint16(offset, negative ? ms + U16_RANGE : ms % MS_PER_MINUTE, LITTLE_ENDIAN);
      view.setUint8(offset + 2, negative ? 0 : Math.floor(ms / MS_PER_MINUTE));
      return;
    }
  }
}
