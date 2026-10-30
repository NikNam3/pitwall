// Test oracle for `decode`: a copy of the generic schema interpreter as it was before the decoder was compiled to
// fixed-shape object literals (protocol `schema/codec.ts` `compileReader`, `decode.ts`, `packets/event.ts`).
// It uses only the specs the protocol package exports, never `decode`, `readField` or `readEventBody`.
// Imports are relative because the repo root does not link workspace packages.
import {
  EVENT_CODE_LENGTH,
  EVENT_DETAILS_SCHEMAS,
  HEADER_SIZE,
  PACKET_BODIES,
  PACKET_FORMAT,
  PACKET_SIZES,
  PacketId,
  headerSchema,
  sizeOf,
  type DecodeError,
  type DecodeResult,
  type EventCode,
  type EventDetails,
  type FieldSpec,
  type Packet,
  type PacketHeader,
  type PacketName,
  type Primitive,
} from '../packages/protocol/src/index.ts';

const LITTLE_ENDIAN = true;
const MS_PER_MINUTE = 60_000;
const U16_RANGE = 65_536;

const decoder = new TextDecoder('utf-8');

type Reader = (view: DataView, offset: number) => unknown;

const PRIMITIVE_READERS: Readonly<Record<Primitive, Reader>> = {
  u8: (v, o) => v.getUint8(o),
  i8: (v, o) => v.getInt8(o),
  u16: (v, o) => v.getUint16(o, LITTLE_ENDIAN),
  i16: (v, o) => v.getInt16(o, LITTLE_ENDIAN),
  u32: (v, o) => v.getUint32(o, LITTLE_ENDIAN),
  i32: (v, o) => v.getInt32(o, LITTLE_ENDIAN),
  u64: (v, o) => v.getBigUint64(o, LITTLE_ENDIAN),
  f32: (v, o) => v.getFloat32(o, LITTLE_ENDIAN),
  f64: (v, o) => v.getFloat64(o, LITTLE_ENDIAN),
};

const readers = new WeakMap<FieldSpec, Reader>();

function readerOf(spec: FieldSpec): Reader {
  let reader = readers.get(spec);
  if (reader === undefined) {
    reader = compileReader(spec);
    readers.set(spec, reader);
  }
  return reader;
}

/** Today's `compileReader`: a struct is built as `{}` with its fields assigned by name in spec order. */
function compileReader(spec: FieldSpec): Reader {
  switch (spec.kind) {
    case 'primitive':
      return PRIMITIVE_READERS[spec.type];
    case 'array': {
      const readItem = readerOf(spec.item);
      const stride = sizeOf(spec.item);
      return (view, offset) => {
        const items: unknown[] = [];
        for (let i = 0; i < spec.length; i++) items.push(readItem(view, offset + i * stride));
        return items;
      };
    }
    case 'struct': {
      let at = 0;
      const members = Object.entries(spec.fields).map(([name, field]) => {
        const member = { name, offset: at, read: readerOf(field) };
        at += sizeOf(field);
        return member;
      });
      return (view, offset) => {
        const result: Record<string, unknown> = {};
        for (const member of members) result[member.name] = member.read(view, offset + member.offset);
        return result;
      };
    }
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
        return minutes === 0 && msPart >= MS_PER_MINUTE ? msPart - U16_RANGE : minutes * MS_PER_MINUTE + msPart;
      };
  }
}

const PACKET_NAMES = new Map<number, PacketName>(
  Object.entries(PacketId).map(([name, id]) => [id, name as PacketName]),
);

const fail = (error: DecodeError): DecodeResult => ({ ok: false, error });

/** Decodes `bytes` exactly as `decode` did before the compiled readers: same packets, same errors. */
export function referenceDecode(bytes: Uint8Array): DecodeResult {
  if (bytes.length < HEADER_SIZE) return fail({ kind: 'truncated', length: bytes.length });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readerOf(headerSchema)(view, 0) as PacketHeader;
  if (header.packetFormat !== PACKET_FORMAT) return fail({ kind: 'wrongFormat', format: header.packetFormat });
  const name = PACKET_NAMES.get(header.packetId);
  if (name === undefined) return fail({ kind: 'unknownPacketId', packetId: header.packetId });
  const expected = PACKET_SIZES[name];
  if (bytes.length !== expected) {
    return fail({ kind: 'sizeMismatch', packetId: header.packetId, expected, actual: bytes.length });
  }
  if (name === 'event') {
    let code = '';
    for (let i = 0; i < EVENT_CODE_LENGTH; i++) code += String.fromCharCode(view.getUint8(HEADER_SIZE + i));
    if (!Object.hasOwn(EVENT_DETAILS_SCHEMAS, code)) return fail({ kind: 'unknownEventCode', code });
    const fields = readerOf(EVENT_DETAILS_SCHEMAS[code as EventCode])(view, HEADER_SIZE + EVENT_CODE_LENGTH) as object;
    const details = { code, ...fields } as EventDetails;
    return { ok: true, packet: { packetId: PacketId.event, header, details } };
  }
  const body = readerOf(PACKET_BODIES[name])(view, HEADER_SIZE) as object;
  return { ok: true, packet: { packetId: header.packetId, header, ...body } as Packet };
}
