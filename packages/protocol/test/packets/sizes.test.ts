// The size check against spec 4.3
import { describe, expect, it } from 'vitest';
import * as p from '../../src/index.ts';
const { HEADER_SIZE, PACKET_BODIES, PACKET_FORMAT, PACKET_SIZES, PacketId, headerSchema, sizeOf } = p;

describe('packet sizes (spec 4.3)', () => {
  it('pins the spec table', () => {
    expect(PACKET_SIZES).toEqual({ motion: 1349, session: 753, lapData: 1285, event: 45, participants: 1284, carSetups: 1133,
      carTelemetry: 1352, carStatus: 1239, finalClassification: 1042, lobbyInfo: 954, carDamage: 1041, sessionHistory: 1460,
      tyreSets: 231, motionEx: 273, timeTrial: 101, lapPositions: 1131 });
    expect(PACKET_FORMAT).toBe(2025);
  });
  it('PacketId covers 0..15 in spec order', () => {
    expect(Object.entries(PacketId)).toEqual(Object.keys(PACKET_SIZES).map((name, id) => [name, id]));
  });
  it('header is 29 bytes', () => {
    expect(HEADER_SIZE).toBe(29);
    expect(sizeOf(headerSchema)).toBe(29);
  });
  it('has a body schema for every packet except event', () => {
    expect(Object.keys(PACKET_BODIES).sort()).toEqual(Object.keys(PACKET_SIZES).filter((n) => n !== 'event').sort());
  });
  it.each(Object.entries(PACKET_BODIES))('%s: header + body = PACKET_SIZES', (name, body) => {
    expect(HEADER_SIZE + sizeOf(body)).toBe(PACKET_SIZES[name as keyof typeof PACKET_SIZES]);
  });
  it.each([
    ['carMotionDataSchema', 60], ['marshalZoneSchema', 5], ['weatherForecastSampleSchema', 8], ['lapDataSchema', 57],
    ['participantDataSchema', 57], ['carSetupDataSchema', 50], ['carTelemetryDataSchema', 60], ['carStatusDataSchema', 55],
    ['finalClassificationDataSchema', 46], ['lobbyInfoDataSchema', 42], ['carDamageDataSchema', 46], ['lapHistoryDataSchema', 14],
    ['tyreStintHistoryDataSchema', 3], ['tyreSetDataSchema', 10], ['timeTrialDataSetSchema', 24],
  ] as const)('element %s is %i bytes', (name, size) => {
    expect(sizeOf(p[name])).toBe(size);
  });
  it('replaces every MSPart/MinutesPart pair with one splitTime field', () => {
    const kinds = (s: p.StructSpec) => Object.fromEntries(Object.entries(s.fields).map(([k, f]) => [k, f.kind]));
    expect(kinds(p.lapDataSchema)).toMatchObject({ sector1TimeMs: 'splitTime', sector2TimeMs: 'splitTime',
      deltaToCarInFrontMs: 'splitTime', deltaToRaceLeaderMs: 'splitTime' });
    expect(kinds(p.lapHistoryDataSchema)).toMatchObject({ sector1TimeMs: 'splitTime', sector2TimeMs: 'splitTime', sector3TimeMs: 'splitTime' });
    const all = JSON.stringify([headerSchema, PACKET_BODIES]);
    expect(all).not.toMatch(/MSPart|MinutesPart|"m_/);
  });
  it('uses camelCase acronyms', () => {
    expect(Object.keys(headerSchema.fields)).toEqual(['packetFormat', 'gameYear', 'gameMajorVersion', 'gameMinorVersion',
      'packetVersion', 'packetId', 'sessionUid', 'sessionTime', 'frameIdentifier', 'overallFrameIdentifier', 'playerCarIndex', 'secondaryPlayerCarIndex']);
    expect(Object.keys(p.carStatusDataSchema.fields)).toEqual(expect.arrayContaining(['vehicleFiaFlags', 'enginePowerIce', 'enginePowerMguk', 'ersHarvestedThisLapMguh']));
    expect(Object.keys(p.sessionBodySchema.fields)).toEqual(expect.arrayContaining(['ersAssist', 'drsAssist', 'affectsLicenceLevelMp']));
  });
});
