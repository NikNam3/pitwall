import { describe, expect, it } from 'vitest';
import { decode, PACKET_SIZES, type PacketName } from '@pitwall/protocol';
import { buildPacket, headerFor, packetBytes, ScenarioBuilder } from './index.ts';

describe('buildPacket', () => {
  it.each(Object.keys(PACKET_SIZES) as PacketName[])('%s encodes to its spec size and decodes back equal', (name) => {
    const p = buildPacket(name);
    const bytes = packetBytes(p);
    expect(bytes.length).toBe(PACKET_SIZES[name]);
    expect(decode(bytes)).toEqual({ ok: true, packet: p });
  });
  it('header defaults and overrides', () => {
    expect(headerFor('lapData')).toMatchObject({ packetFormat: 2025, packetId: 2, sessionUid: 1n, secondaryPlayerCarIndex: 255 });
    expect(buildPacket('motion', { header: { frameIdentifier: 7 } }).header).toMatchObject({ packetId: 0, frameIdentifier: 7 });
  });
  it('merges array overrides by index and keeps 22 cars', () => {
    const p = buildPacket('lapData', { lapData: { 3: { carPosition: 4 } } });
    expect([p.lapData.length, p.lapData[3]!.carPosition, p.lapData[2]!.carPosition]).toEqual([22, 4, 0]);
  });
  it('builds event details for the given code', () => {
    expect(buildPacket('event', { details: { code: 'FTLP', vehicleIdx: 2, lapTime: 80.5 } }).details).toEqual({ code: 'FTLP', vehicleIdx: 2, lapTime: 80.5 });
  });
});

describe('ScenarioBuilder', () => {
  it('build() yields one frame per frame() with the menu-rate group, session and participants first', () => {
    const fs = new ScenarioBuilder({ cars: 3, player: 2, stepMs: 20 }).frames(3, () => {}).build();
    expect(fs.map((f) => [f.frameId, f.sessionTime, f.playerCarIndex])).toEqual([[0, 0, 2], [1, 20, 2], [2, 40, 2]]);
    for (const f of fs) for (const k of ['motion', 'lapData', 'telemetry', 'status', 'motionEx'] as const) expect(f[k]).toBeDefined();
    expect(fs[0]!.participants).toMatchObject({ numActiveCars: 3 });
    expect(fs[0]!.participants!.participants[2]).toMatchObject({ aiControlled: 0, networkId: 0, teamId: 1, raceNumber: 3 });
    expect(fs[1]!.lapData!.lapData[1]).toMatchObject({ carPosition: 2, currentLapNum: 1, resultStatus: 2 });
    expect([fs[0]!.session!.trackLength, fs[1]!.session]).toEqual([5000, undefined]);
  });
  it('carries draft changes forward; drop() and add() shape single frames', () => {
    const fs = new ScenarioBuilder({ cars: 2 })
      .frame((d) => { d.lapData.lapData[0]!.currentLapNum = 2; })
      .frame((d) => d.drop('motion'))
      .frame((d) => { d.add('carDamage'); })
      .build();
    expect(fs[1]!.lapData!.lapData[0]!.currentLapNum).toBe(2);
    expect([fs[1]!.motion, fs[2]!.motion === undefined]).toEqual([undefined, false]);
    expect(fs[2]!.damage).toBeDefined();
  });
  it('queues session(), participants() and event() into the next frame; trailing ones get their own frame', () => {
    const fs = new ScenarioBuilder({ cars: 2 }).frames(1, () => {})
      .session({ totalLaps: 5 }).event({ code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }).frames(1, () => {})
      .event({ code: 'FTLP', vehicleIdx: 1, lapTime: 80 }).build();
    expect(fs).toHaveLength(3);
    expect(fs[1]!.session!.totalLaps).toBe(5);
    expect(fs[1]!.events.map((e) => e.details.code)).toEqual(['OVTK']);
    expect([fs[2]!.events[0]!.details.code, fs[2]!.lapData]).toEqual(['FTLP', undefined]);
  });
  it('packets() starts with the Session packet and has non-decreasing receivedAtMs', () => {
    const ps = new ScenarioBuilder({ sessionUid: 42n }).frames(4, () => {}).packets();
    expect(ps[0]!.packet).toMatchObject({ packetId: 1, header: { sessionUid: 42n } });
    expect(ps.every((p, i) => i === 0 || p.receivedAtMs >= ps[i - 1]!.receivedAtMs)).toBe(true);
    expect(ps.at(-1)!.receivedAtMs).toBe(48);
  });
});
