// Committed segments (`fixtures/segments/`) for the packages' tests, as the decoder reads their packets. The bridge's
// own tests use `apps/bridge/test/fixtures/replay.ts`. One reader of the `.pwrec` format: the bridge's.
import { join } from 'node:path';
import { readPwrec } from '../apps/bridge/src/pwrec/reader.ts';
import { decode, type Packet } from '../packages/protocol/src/index.ts';

/** The committed segment `file` of `fixtures/segments/`. */
export const segmentPath = (file: string): string => join(import.meta.dirname, '../fixtures/segments', file);

/** Every decodable packet of the segment `file`, in file order, with the time it was received. */
export async function segmentPackets(file: string): Promise<Array<{ packet: Packet; receivedAtMs: number }>> {
  const packets: Array<{ packet: Packet; receivedAtMs: number }> = [];
  for await (const r of readPwrec(segmentPath(file))) {
    const d = decode(r.payload);
    if (d.ok) packets.push({ packet: d.packet, receivedAtMs: r.t });
  }
  return packets;
}
