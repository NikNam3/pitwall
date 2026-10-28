import { PacketId, type PacketName } from './header.ts';

/** Packet name by packet id, e.g. `PACKET_NAMES[2]` is `'lapData'`. Internal to decode/encode, not exported from the package. */
export const PACKET_NAMES = Object.fromEntries(
  Object.entries(PacketId).map(([name, id]) => [id, name]),
) as { readonly [N in PacketName as (typeof PacketId)[N]]: N };

export const isPacketId = (id: number): id is PacketId => Object.hasOwn(PACKET_NAMES, id);

/** A DataView over exactly the bytes of `bytes`, which may itself be a view into a larger buffer. */
export const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
