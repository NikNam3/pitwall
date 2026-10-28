import { decode, encode, HEADER_SIZE, PacketId, peekHeader, type PacketHeader } from '@pitwall/protocol';
import type { PwrecRecord } from './types.ts';

/** Session time window in seconds, both ends inclusive. */
export type CutRange = { fromS: number; toS: number };

export type CutRecord = { t: number; payload: Uint8Array };

export type CutResult = {
  /** Context packets and window records in file order, `t` rebased so the first window record is at 0. */
  records: CutRecord[];
  /** `t` of the first window record in the source file. */
  firstT: number | undefined;
  contextPackets: number;
  durationMs: number;
};

/**
 * Packets a segment needs to be self-contained, emitted in this order. A session opens only with a Session packet,
 * and Participants arrives only every few seconds. Packets that repeat at 1 Hz or more are not kept.
 */
export const CONTEXT_PACKET_IDS: readonly number[] = [PacketId.session, PacketId.participants];

type ContextPacket = { header: PacketHeader; payload: Uint8Array };

/** Re-stamps a context packet into the frame of `reference`, keeping its body bytes. Undefined if it does not decode. */
function restamp({ payload }: ContextPacket, reference: PacketHeader): Uint8Array | undefined {
  const decoded = decode(payload);
  if (!decoded.ok) return undefined;
  const { sessionTime, frameIdentifier, overallFrameIdentifier } = reference;
  const { packet } = decoded;
  return encode({ ...packet, header: { ...packet.header, sessionTime, frameIdentifier, overallFrameIdentifier } });
}

function partition<T>(items: readonly T[], test: (item: T) => boolean): [T[], T[]] {
  return [items.filter(test), items.filter((item) => !test(item))];
}

/**
 * Cuts the records whose header session time is in `range`. Session time can jump back after a flashback, so every
 * record is tested. The latest context packets seen before the window are written in front of the first window
 * record of the same session.
 */
export async function cutRecords(records: AsyncIterable<PwrecRecord>, range: CutRange): Promise<CutResult> {
  const latestContext = new Map<number, ContextPacket>();
  const out: CutRecord[] = [];
  let pendingContext: ContextPacket[] | undefined;
  let firstT: number | undefined;
  let contextPackets = 0;

  for await (const { t, payload } of records) {
    const header = payload.length >= HEADER_SIZE ? peekHeader(payload) : undefined;
    if (header === undefined) continue;
    const inWindow = range.fromS <= header.sessionTime && header.sessionTime <= range.toS;
    if (!inWindow) {
      if (firstT === undefined && CONTEXT_PACKET_IDS.includes(header.packetId) && header.sessionUid !== 0n) {
        latestContext.set(header.packetId, { header, payload });
      }
      continue;
    }
    firstT ??= t;
    pendingContext ??= CONTEXT_PACKET_IDS.flatMap((id) => latestContext.get(id) ?? []);
    const rebased = t - firstT;
    const [matching, others] = partition(pendingContext, (c) => c.header.sessionUid === header.sessionUid);
    pendingContext = others;
    for (const context of matching) {
      const restamped = restamp(context, header);
      if (restamped === undefined) continue;
      out.push({ t: rebased, payload: restamped });
      contextPackets++;
    }
    out.push({ t: rebased, payload });
  }
  return { records: out, firstT, contextPackets, durationMs: out.at(-1)?.t ?? 0 };
}
