import { HEADER_SIZE, PACKET_FORMAT, PacketId, headerSchema, type PacketHeader } from './header.ts';
import type { Packet } from './packet.ts';
import { readEventBody } from './packets/event.ts';
import { PACKET_BODIES } from './packets/index.ts';
import { readField } from './schema/codec.ts';
import { PACKET_SIZES } from './sizes.ts';
import { PACKET_NAMES, isPacketId, viewOf } from './wire.ts';

export type DecodeError =
  | { kind: 'truncated'; length: number }
  | { kind: 'wrongFormat'; format: number }
  | { kind: 'unknownPacketId'; packetId: number }
  | { kind: 'sizeMismatch'; packetId: number; expected: number; actual: number }
  | { kind: 'unknownEventCode'; code: string };

export type DecodeResult = { ok: true; packet: Packet } | { ok: false; error: DecodeError };

const fail = (error: DecodeError): DecodeResult => ({ ok: false, error });

/** Reads the header without validating format, id or size; `undefined` below 29 bytes. */
export function peekHeader(bytes: Uint8Array): PacketHeader | undefined {
  return bytes.length < HEADER_SIZE ? undefined : readField(headerSchema, viewOf(bytes), 0);
}

export function decode(bytes: Uint8Array): DecodeResult {
  const header = peekHeader(bytes);
  if (header === undefined) return fail({ kind: 'truncated', length: bytes.length });
  if (header.packetFormat !== PACKET_FORMAT) return fail({ kind: 'wrongFormat', format: header.packetFormat });
  if (!isPacketId(header.packetId)) return fail({ kind: 'unknownPacketId', packetId: header.packetId });
  const name = PACKET_NAMES[header.packetId];
  const expected = PACKET_SIZES[name];
  if (bytes.length !== expected) {
    return fail({ kind: 'sizeMismatch', packetId: header.packetId, expected, actual: bytes.length });
  }
  const view = viewOf(bytes);
  if (name === 'event') {
    const event = readEventBody(view, HEADER_SIZE);
    if (!event.ok) return fail({ kind: 'unknownEventCode', code: event.code });
    return { ok: true, packet: { packetId: PacketId.event, header, details: event.details } };
  }
  const body = readField(PACKET_BODIES[name], view, HEADER_SIZE);
  return { ok: true, packet: { packetId: header.packetId, header, ...body } as Packet };
}
