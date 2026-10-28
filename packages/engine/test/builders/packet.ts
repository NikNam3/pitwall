// Packets for tests: the decode of a zeroed body, deep-merged with the test's overrides.
import {
  decode,
  encode,
  headerSchema,
  PACKET_SIZES,
  PacketId,
  writeField,
  type Packet,
  type PacketHeader,
  type PacketName,
  type PacketOf,
} from '@pitwall/protocol';

/** Overrides for a packet: objects merge key by key, arrays merge element by element by index. */
export type DeepPartial<T> = T extends bigint | number | string | boolean
  ? T
  : T extends readonly (infer U)[]
    ? { [i: number]: DeepPartial<U> }
    : { [K in keyof T]?: DeepPartial<T[K]> };

const EVENT_CODE_AT = 29;

export const headerFor = (id: PacketName, o: Partial<PacketHeader> = {}): PacketHeader => ({
  packetFormat: 2025,
  gameYear: 25,
  gameMajorVersion: 1,
  gameMinorVersion: 0,
  packetVersion: 1,
  packetId: PacketId[id],
  sessionUid: 1n,
  sessionTime: 0,
  frameIdentifier: 0,
  overallFrameIdentifier: 0,
  playerCarIndex: 0,
  secondaryPlayerCarIndex: 255,
  ...o,
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Merges `over` onto `base` without touching either; `undefined` entries and array holes keep the base value. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (!isObject(base) || !isObject(over)) return over;
  const merged = (Array.isArray(base) ? [...base] : { ...base }) as Record<string, unknown>;
  for (const key of Object.keys(over)) merged[key] = deepMerge(merged[key], over[key]);
  return merged;
}

/** The packet `decode` reads from a zeroed body (arrays hold 22 cars) with `o` merged on top. */
export function buildPacket<N extends PacketName>(name: N, o?: DeepPartial<PacketOf<N>>): PacketOf<N> {
  const { header, ...body } = (o ?? {}) as { header?: Partial<PacketHeader> };
  const bytes = new Uint8Array(PACKET_SIZES[name]);
  writeField(headerSchema, new DataView(bytes.buffer), 0, headerFor(name));
  if (name === 'event') {
    const code = (o as { details?: { code?: string } } | undefined)?.details?.code ?? 'SSTA';
    bytes.set(new TextEncoder().encode(code), EVENT_CODE_AT);
  }
  const decoded = decode(bytes);
  if (!decoded.ok) throw new Error(`buildPacket ${name}: ${decoded.error.kind}`);
  return { ...(deepMerge(decoded.packet, body) as Packet), header: headerFor(name, header) } as PacketOf<N>;
}

export const packetBytes = (p: Packet): Uint8Array => encode(p);
