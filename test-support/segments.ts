// Committed segments (`fixtures/segments/`) for the packages' tests, as the decoder reads their packets. The bridge's
// own tests use `apps/bridge/test/fixtures/replay.ts`. One reader of the `.pwrec` format: the bridge's.
import { join } from 'node:path';
import { readPwrec } from '../apps/bridge/src/pwrec/reader.ts';
import { decode, type Packet } from '../packages/protocol/src/index.ts';

/**
 * Committed segments named by id, as `FIXTURES` names the full recordings: id to file of `fixtures/segments/`.
 * Provenance and what each shows: the `segments` entries of `fixtures/index.json`.
 */
export const SEGMENTS = {
  practiceGarageRestartLine: 'practice-garage-restart-line.pwrec.gz',
  raceScAfterCollision: 'race-sc-after-collision.pwrec.gz',
  raceWarningCollision: 'race-warning-collision.pwrec.gz',
} as const;

export type SegmentName = keyof typeof SEGMENTS;

/** The committed segment `file` of `fixtures/segments/`. */
export const segmentPath = (file: string): string => join(import.meta.dirname, '../fixtures/segments', file);

/** Every record's raw payload of the segment `file`, in file order: the decoder's input. */
export async function segmentPayloads(file: string): Promise<Uint8Array[]> {
  const payloads: Uint8Array[] = [];
  for await (const r of readPwrec(segmentPath(file))) payloads.push(r.payload);
  return payloads;
}

/** Every decodable packet of the segment `file`, in file order, with the time it was received. */
export async function segmentPackets(file: string): Promise<Array<{ packet: Packet; receivedAtMs: number }>> {
  const packets: Array<{ packet: Packet; receivedAtMs: number }> = [];
  for await (const r of readPwrec(segmentPath(file))) {
    const d = decode(r.payload);
    if (d.ok) packets.push({ packet: d.packet, receivedAtMs: r.t });
  }
  return packets;
}
