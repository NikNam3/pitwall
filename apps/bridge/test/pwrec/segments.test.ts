// committed segments, no full recordings needed
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decode, type Packet } from '@pitwall/protocol';
import { drain } from './helpers.ts';

const SEG = join(import.meta.dirname, '../../../../fixtures/segments');
async function load(file: string) {
  const { records, summary } = await drain(join(SEG, file));
  const packets = records.map((r) => { const d = decode(r.payload); if (!d.ok) throw new Error(JSON.stringify(d.error)); return d.packet; });
  const codes: Record<string, number> = {};
  for (const p of packets) if (p.packetId === 3) codes[p.details.code] = (codes[p.details.code] ?? 0) + 1;
  return { records, summary, packets, codes };
}
const ids = (ps: Packet[]) => ps.map((p) => p.packetId);

describe('committed segments', () => {
  it('tt-zandvoort-lap1: context first, end of lap 1 with FTLP 71.910 s', async () => {
    const s = await load('tt-zandvoort-lap1.pwrec.gz');
    expect(s.records).toHaveLength(2144);
    expect(ids(s.packets.slice(0, 2))).toEqual([1, 4]);
    expect(s.packets[0]!.header.frameIdentifier).toBe(s.packets[2]!.header.frameIdentifier);
    expect(s.codes).toEqual({ FTLP: 1, SPTP: 1, BUTN: 3 });
    const ftlp = s.packets.find((p) => p.packetId === 3 && p.details.code === 'FTLP');
    expect(ftlp).toMatchObject({ details: { vehicleIdx: 0 } });
    expect((ftlp as { details: { lapTime: number } }).details.lapTime).toBeCloseTo(71.91, 3);
    const laps = new Set(s.packets.flatMap((p) => (p.packetId === 2 ? [p.lapData[0]!.currentLapNum] : [])));
    expect([...laps]).toEqual([1, 2]);
    expect(s.summary).toMatchObject({ endedCleanly: true, meta: { startedAt: '2026-10-27T22:33:35.674Z',
      cut: { source: '2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz', fromS: 112, toS: 118, contextPackets: 2 } } });
    expect(s.summary.durationMs).toBeCloseTo(5979.381, 2);
  });
  it('race-singapore-start: start lights and lights out, session opened by a later Session packet', async () => {
    const s = await load('race-singapore-start.pwrec.gz');
    expect(s.records).toHaveLength(2169);
    expect(s.packets[0]!.packetId).toBe(3);
    expect(s.codes).toEqual({ BUTN: 8, SSTA: 1, STLG: 5, LGOT: 1 });
    expect(s.summary).toMatchObject({ endedCleanly: true, meta: { startedAt: '2026-10-27T23:15:04.898Z', cut: { fromS: 0, toS: 0.5, contextPackets: 0 } } });
    expect(s.summary.durationMs).toBeCloseTo(8750.935, 2);
  });
  it('race-singapore-end: 20 UID-0 SessionHistory packets (cars 0-19) arrive before SEND', async () => {
    const s = await load('race-singapore-end.pwrec.gz');
    expect(s.records).toHaveLength(696);
    expect(s.codes).toEqual({ BUTN: 18, COLL: 1, SEND: 1 });
    const uid0 = s.packets.flatMap((p, i) => (p.header.sessionUid === 0n ? [{ p, i }] : []));
    expect(uid0.map(({ p }) => (p.packetId === 11 ? p.carIdx : -1))).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const send = s.packets.findIndex((p) => p.packetId === 3 && p.details.code === 'SEND');
    expect(uid0.every(({ i }) => i < send)).toBe(true);
    expect(s.summary).toMatchObject({ endedCleanly: true, meta: { startedAt: '2026-10-27T23:16:14.670Z', cut: { fromS: 61.5, toS: 63.4, contextPackets: 2 } } });
    expect(s.summary.durationMs).toBeCloseTo(3265.341, 2);
  });
});
