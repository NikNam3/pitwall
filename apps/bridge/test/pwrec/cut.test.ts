import { describe, expect, it } from 'vitest';
import { decode, peekHeader, type PacketName } from '@pitwall/protocol';
import { buildPacket, headerFor, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { cutRecords } from '../../src/pwrec/cut.ts';
import type { PwrecRecord } from '../../src/pwrec/types.ts';

const pkt = (name: PacketName, sessionTime: number, frame: number, sessionUid = 7n) =>
  packetBytes(buildPacket(name, { header: headerFor(name, { sessionUid, sessionTime, frameIdentifier: frame, overallFrameIdentifier: frame }) }));
const rec = (t: number, payload: Uint8Array): PwrecRecord => ({ kind: 0, t, payload });
async function* stream(rs: PwrecRecord[]) { yield* rs; }
const hdr = (b: Uint8Array) => peekHeader(b)!;

const INPUT = [
  rec(100, pkt('session', 9, 90)), rec(110, pkt('participants', 9.25, 91)), rec(120, pkt('participants', 9.5, 92)),
  rec(125, pkt('session', 9.5, 92, 0n)), rec(130, pkt('lapData', 9.75, 93)), rec(140, new Uint8Array(10)),
  rec(150, pkt('lapData', 10, 94)), rec(160, pkt('motion', 10.5, 95)), rec(170, pkt('lapData', 11, 96)), rec(180, pkt('lapData', 11.25, 97)),
];

describe('cutRecords', () => {
  it('keeps records with sessionTime in [from, to] inclusive, rebased to t = 0', async () => {
    const r = await cutRecords(stream(INPUT), { fromS: 10, toS: 11 });
    const window = r.records.slice(r.contextPackets);
    expect(window.map((x) => x.t)).toEqual([0, 10, 20]);
    expect(window.map((x) => hdr(x.payload).frameIdentifier)).toEqual([94, 95, 96]);
    expect(r).toMatchObject({ firstT: 150, durationMs: 20 });
  });
  it('prepends the latest Session and Participants (uid != 0), re-stamped into the first window frame, bodies untouched', async () => {
    const r = await cutRecords(stream(INPUT), { fromS: 10, toS: 11 });
    expect(r.contextPackets).toBe(2);
    const [s, p, first] = r.records;
    expect([s!.t, p!.t]).toEqual([0, 0]);
    expect([hdr(s!.payload).packetId, hdr(p!.payload).packetId]).toEqual([1, 4]);
    for (const c of [s!, p!]) {
      expect(hdr(c.payload)).toMatchObject({ sessionUid: 7n, sessionTime: 10, frameIdentifier: 94, overallFrameIdentifier: 94 });
      expect(decode(c.payload).ok).toBe(true);
    }
    expect(p!.payload.subarray(29)).toEqual(INPUT[2]!.payload.subarray(29));
    expect(s!.payload.subarray(29)).toEqual(INPUT[0]!.payload.subarray(29));
    expect(hdr(first!.payload).frameIdentifier).toBe(94);
  });
  it('needs no context when the window starts at the beginning', async () => {
    const r = await cutRecords(stream(INPUT), { fromS: 0, toS: 9.25 });
    expect(r.contextPackets).toBe(0);
    expect(r.records.map((x) => x.t)).toEqual([0, 10]);
  });
  it('drops context whose session never appears in the window', async () => {
    const other = [...INPUT.slice(0, 3), rec(150, pkt('lapData', 10, 94, 8n))];
    expect((await cutRecords(stream(other), { fromS: 10, toS: 11 })).contextPackets).toBe(0);
  });
  it('re-enters the window after a flashback (session time going back)', async () => {
    const fb = [rec(0, pkt('lapData', 10, 1)), rec(10, pkt('lapData', 12, 2)), rec(20, pkt('lapData', 10.5, 3))];
    expect((await cutRecords(stream(fb), { fromS: 10, toS: 11 })).records.map((x) => x.t)).toEqual([0, 20]);
  });
  it('an empty window yields no records and duration 0', async () => {
    expect(await cutRecords(stream(INPUT), { fromS: 50, toS: 60 })).toEqual({ records: [], firstT: undefined, contextPackets: 0, durationMs: 0 });
  });
});
