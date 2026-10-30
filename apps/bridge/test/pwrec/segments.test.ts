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
  // Cut with pwrec-cut from the whole recordings; provenance and verified facts in fixtures/index.json.
  it.each([
    ['race-zandvoort-lap10.pwrec.gz', 1778, { OVTK: 2, SPTP: 2, FTLP: 1 }, 721, 726],
    ['race-zandvoort-pit-stop.pwrec.gz', 2424, { OVTK: 3, SPTP: 5, BUTN: 1 }, 548.2, 555],
    ['race-zandvoort-pit-exit.pwrec.gz', 536, { SPTP: 2 }, 564.5, 566],
    ['race-zandvoort-vsc.pwrec.gz', 1073, { OVTK: 3, SCAR: 1, DRSD: 1, RTMT: 1 }, 913.5, 916.5],
    ['race-zandvoort-retire.pwrec.gz', 1487, { OVTK: 5, PENA: 2, RTMT: 1, SCAR: 3, BUTN: 10 }, 1205, 5846],
    ['race-singapore-wet-flashback.pwrec.gz', 2170, { BUTN: 22, FLBK: 1 }, 741.5, 744.5],
    ['qualifying-singapore-end.pwrec.gz', 70, { SPTP: 1, SEND: 1, BUTN: 6 }, 899, 900.6],
  ] as const)('%s: %i records, context (Session, Participants) first, these events, clean end', async (file, records, codes, fromS, toS) => {
    const s = await load(file);
    expect(s.records).toHaveLength(records);
    expect(ids(s.packets.slice(0, 2))).toEqual([1, 4]);
    expect(s.codes).toEqual(codes);
    expect(s.summary).toMatchObject({ endedCleanly: true, meta: { cut: { fromS, toS, contextPackets: 2 } } });
  });
});
