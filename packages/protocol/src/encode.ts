import { HEADER_SIZE, PacketId, headerSchema } from './header.ts';
import type { Packet } from './packet.ts';
import { writeEventBody } from './packets/event.ts';
import { PACKET_BODIES } from './packets/index.ts';
import { writeField } from './schema/codec.ts';
import { PACKET_SIZES } from './sizes.ts';
import { PACKET_NAMES, viewOf } from './wire.ts';

/** Encodes a packet to exactly `PACKET_SIZES[name]` bytes: the inverse of `decode`. */
export function encode(packet: Packet): Uint8Array {
  const bytes = new Uint8Array(PACKET_SIZES[PACKET_NAMES[packet.packetId]]);
  const view = viewOf(bytes);
  writeField(headerSchema, view, 0, packet.header);
  if (packet.packetId === PacketId.event) writeEventBody(view, HEADER_SIZE, packet.details);
  else writeField(PACKET_BODIES[PACKET_NAMES[packet.packetId]], view, HEADER_SIZE, packet);
  return bytes;
}
