// Real decodable packets: zeroed body, chosen header; a shorthand over `buildPacket`.
import type { EventCode, PacketName, PacketOf } from '@pitwall/protocol';
import { buildPacket, type DeepPartial } from '../builders/index.ts';

export type StubOpts = { uid?: bigint; overall?: number; player?: number; code?: EventCode; carIdx?: number };

export function stub<N extends PacketName>(name: N, frameId: number, sessionTimeS: number, o: StubOpts = {}): PacketOf<N> {
  const header = {
    sessionUid: o.uid ?? 7n,
    sessionTime: sessionTimeS,
    frameIdentifier: frameId,
    overallFrameIdentifier: o.overall ?? frameId,
    playerCarIndex: o.player ?? 0,
  };
  const body = name === 'event' ? { details: { code: o.code ?? 'BUTN' } } : name === 'sessionHistory' || name === 'tyreSets' ? { carIdx: o.carIdx ?? 0 } : {};
  return buildPacket(name, { header, ...body } as DeepPartial<PacketOf<N>>);
}

export const menuGroup = (frameId: number, sessionTimeS: number, o: StubOpts = {}) =>
  (['lapData', 'motion', 'carTelemetry', 'carStatus', 'motionEx'] as const).map((n) => stub(n, frameId, sessionTimeS, o));
