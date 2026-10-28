// Real decodable packets: zeroed body, chosen header.
import { decode, headerSchema, PACKET_SIZES, PacketId, writeField, type EventCode, type PacketName, type PacketOf } from '@pitwall/protocol';

export type StubOpts = { uid?: bigint; overall?: number; player?: number; code?: EventCode; carIdx?: number };

export function stub<N extends PacketName>(name: N, frameId: number, sessionTimeS: number, o: StubOpts = {}): PacketOf<N> {
  const bytes = new Uint8Array(PACKET_SIZES[name]);
  writeField(headerSchema, new DataView(bytes.buffer), 0, {
    packetFormat: 2025,
    gameYear: 25,
    gameMajorVersion: 1,
    gameMinorVersion: 0,
    packetVersion: 1,
    packetId: PacketId[name],
    sessionUid: o.uid ?? 7n,
    sessionTime: sessionTimeS,
    frameIdentifier: frameId,
    overallFrameIdentifier: o.overall ?? frameId,
    playerCarIndex: o.player ?? 0,
    secondaryPlayerCarIndex: 255,
  });
  if (name === 'event') bytes.set(new TextEncoder().encode(o.code ?? 'BUTN'), 29);
  if (name === 'sessionHistory' || name === 'tyreSets') bytes[29] = o.carIdx ?? 0;
  const r = decode(bytes);
  if (!r.ok) throw new Error(`stub ${name}: ${r.error.kind}`);
  return r.packet as PacketOf<N>;
}

export const menuGroup = (frameId: number, sessionTimeS: number, o: StubOpts = {}) =>
  (['lapData', 'motion', 'carTelemetry', 'carStatus', 'motionEx'] as const).map((n) => stub(n, frameId, sessionTimeS, o));
