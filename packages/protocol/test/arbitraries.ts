import fc from 'fast-check';
import { EVENT_CODES, EVENT_DETAILS_SCHEMAS, PACKET_BODIES, PACKET_FORMAT, PacketId, SPLIT_TIME_MAX_MS, SPLIT_TIME_MIN_MS, headerSchema,
  type EventDetails, type FieldSpec, type Infer, type PacketName, type PacketOf } from '../src/index.ts';

const INT = { u8: [0, 255], i8: [-128, 127], u16: [0, 65535], i16: [-32768, 32767], u32: [0, 2 ** 32 - 1], i32: [-(2 ** 31), 2 ** 31 - 1] } as const;
const utf8 = new TextEncoder();

export function arbitraryFor<S extends FieldSpec>(spec: S): fc.Arbitrary<Infer<S>> {
  const s: FieldSpec = spec;
  const arb = ((): fc.Arbitrary<unknown> => {
    switch (s.kind) {
      case 'primitive': {
        const t = s.type;
        if (t === 'u64') return fc.bigInt({ min: 0n, max: 2n ** 64n - 1n });
        if (t === 'f32') return fc.float().map(Math.fround);   // f32-representable, incl. NaN/-0/±Infinity
        if (t === 'f64') return fc.double();
        return fc.integer({ min: INT[t][0], max: INT[t][1] });
      }
      case 'array': return fc.array(arbitraryFor(s.item), { minLength: s.length, maxLength: s.length });
      case 'struct': return fc.record(Object.fromEntries(Object.entries(s.fields).map(([k, f]) => [k, arbitraryFor(f)])));
      case 'chars': return fc.string({ unit: 'grapheme', maxLength: 8 }).filter((v) => !v.includes('\0') && utf8.encode(v).length < s.length);
      case 'splitTime': return fc.integer({ min: SPLIT_TIME_MIN_MS, max: SPLIT_TIME_MAX_MS });
    }
  })();
  return arb as fc.Arbitrary<Infer<S>>;
}

export const arbitraryEventDetails = (): fc.Arbitrary<EventDetails> =>
  fc.constantFrom(...EVENT_CODES).chain((code) => arbitraryFor(EVENT_DETAILS_SCHEMAS[code]).map((f) => ({ code, ...f }) as EventDetails));

export function arbitraryPacket<N extends PacketName>(name: N): fc.Arbitrary<PacketOf<N>> {
  const header = arbitraryFor(headerSchema).map((h) => ({ ...h, packetFormat: PACKET_FORMAT, packetId: PacketId[name] }));
  const body: fc.Arbitrary<object> = name === 'event' ? arbitraryEventDetails().map((details) => ({ details })) : arbitraryFor(PACKET_BODIES[name as Exclude<N, 'event'>]);
  return fc.tuple(header, body).map(([h, b]) => ({ packetId: PacketId[name], header: h, ...b }) as unknown as PacketOf<N>);
}
