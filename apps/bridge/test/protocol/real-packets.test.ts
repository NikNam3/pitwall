import { expect, it } from 'vitest';
import { decode, encode, type Packet } from '@pitwall/protocol';
import { describeWithFixture, fixturePath } from '../../../../test-support/fixtures.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describeWithFixture('raceSingapore', 'real packets: raceSingapore', () => {
  it('every datagram decodes and re-encodes byte-identically', async () => {
    const perId = new Map<number, number>();
    const events = new Map<string, number>();
    const changed: number[] = [];
    let negativeDeltas = 0;
    let total = 0, firstSession: Packet | undefined, firstParticipants: Packet | undefined;
    for await (const record of readPwrec(fixturePath('raceSingapore')!)) {
      total++;
      const r = decode(record.payload);
      if (!r.ok) throw new Error(`datagram ${total}: ${JSON.stringify(r.error)}`);
      const p = r.packet;
      perId.set(p.packetId, (perId.get(p.packetId) ?? 0) + 1);
      if (p.packetId === 3) events.set(p.details.code, (events.get(p.details.code) ?? 0) + 1);
      firstSession ??= p.packetId === 1 ? p : undefined;
      firstParticipants ??= p.packetId === 4 ? p : undefined;
      const again = encode(p);
      if (!equalBytes(again, record.payload)) changed.push(p.packetId);
      if (p.packetId === 2 && p.lapData.some((c) => c.deltaToCarInFrontMs < 0 || c.deltaToRaceLeaderMs < 0)) negativeDeltas++;
    }
    expect(total).toBe(24_726);
    expect(Object.fromEntries(perId)).toEqual({ 0: 4137, 1: 139, 2: 4137, 3: 231, 4: 15, 5: 139, 6: 4137, 7: 4137, 10: 691, 11: 1376, 12: 1380, 13: 4137, 15: 70 });
    expect(Object.fromEntries(events)).toEqual({ BUTN: 154, SSTA: 1, STLG: 5, LGOT: 1, OVTK: 39, SPTP: 20, COLL: 4, PENA: 6, SEND: 1 });
    expect(changed).toEqual([]);
    expect(negativeDeltas).toBe(795);
    expect(firstSession).toMatchObject({ header: { sessionUid: 12956020372289608894n }, trackId: 12, sessionType: 15, totalLaps: 5, trackLength: 4928 });
    expect(firstParticipants).toMatchObject({ header: { playerCarIndex: 19 }, numActiveCars: 20 });
    if (firstParticipants?.packetId !== 4) throw new Error('no participants');
    expect(firstParticipants.participants.map((d) => d.aiControlled).slice(0, 20)).toEqual([...Array(19).fill(1), 0]);
  }, 60_000);
});
