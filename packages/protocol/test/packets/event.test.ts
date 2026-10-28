import { describe, expect, it } from 'vitest';
import { EVENT_CODES, EVENT_DETAILS_LENGTH, EVENT_DETAILS_SCHEMAS, isEventCode, readEventBody, sizeOf, writeEventBody,
  type EventDetails } from '../../src/index.ts';

const f32 = Math.fround;
const SAMPLES: EventDetails[] = [
  { code: 'SSTA' }, { code: 'SEND' }, { code: 'FTLP', vehicleIdx: 3, lapTime: f32(71.91) }, { code: 'RTMT', vehicleIdx: 4, reason: 8 },
  { code: 'DRSE' }, { code: 'DRSD', reason: 1 }, { code: 'TMPT', vehicleIdx: 19 }, { code: 'CHQF' }, { code: 'RCWN', vehicleIdx: 0 },
  { code: 'PENA', penaltyType: 1, infringementType: 2, vehicleIdx: 3, otherVehicleIdx: 4, time: 5, lapNum: 6, placesGained: 7 },
  { code: 'SPTP', vehicleIdx: 19, speed: f32(318.5), isOverallFastestInSession: 1, isDriverFastestInSession: 1, fastestVehicleIdxInSession: 19, fastestSpeedInSession: f32(318.5) },
  { code: 'STLG', numLights: 5 }, { code: 'LGOT' }, { code: 'DTSV', vehicleIdx: 2 }, { code: 'SGSV', vehicleIdx: 2, stopTime: f32(10.5) },
  { code: 'FLBK', flashbackFrameIdentifier: 123_456, flashbackSessionTime: f32(1234.5) }, { code: 'BUTN', buttonStatus: 0x0010_0001 },
  { code: 'RDFL' }, { code: 'OVTK', overtakingVehicleIdx: 7, beingOvertakenVehicleIdx: 8 }, { code: 'SCAR', safetyCarType: 2, eventType: 0 },
  { code: 'COLL', vehicle1Idx: 1, vehicle2Idx: 19 },
];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
function body(details: EventDetails): Uint8Array {
  const buf = new Uint8Array(16).fill(0xaa);
  writeEventBody(new DataView(buf.buffer), 0, details);
  return buf;
}

describe('event codes', () => {
  it('has the 21 codes of the spec, each with a details schema of at most 12 bytes', () => {
    expect(EVENT_CODES).toHaveLength(21);
    expect(EVENT_DETAILS_LENGTH).toBe(12);
    expect(Object.keys(EVENT_DETAILS_SCHEMAS).sort()).toEqual([...EVENT_CODES].sort());
    for (const code of EVENT_CODES) expect(sizeOf(EVENT_DETAILS_SCHEMAS[code])).toBeLessThanOrEqual(12);
    expect(sizeOf(EVENT_DETAILS_SCHEMAS.SPTP)).toBe(12);
    expect(SAMPLES.map((s) => s.code)).toEqual(EVENT_CODES);
  });
  it('isEventCode', () => {
    expect(isEventCode('FLBK')).toBe(true);
    expect(isEventCode('flbk')).toBe(false);
    expect(isEventCode('ABCD')).toBe(false);
  });
});

describe('event body', () => {
  it.each(SAMPLES.map((s) => [s.code, s] as const))('%s round-trips', (_c, details) => {
    const buf = body(details);
    expect(readEventBody(new DataView(buf.buffer), 0)).toEqual({ ok: true, details });
  });
  it('writes the code as 4 ASCII bytes and zero-pads the 12 detail bytes', () => {
    expect([...body({ code: 'SSTA' })]).toEqual([...ascii('SSTA'), ...Array(12).fill(0)]);
    const ftlp = body({ code: 'FTLP', vehicleIdx: 3, lapTime: f32(71.91) });
    const lap = new Uint8Array(new Float32Array([71.91]).buffer);   // platform LE
    expect([...ftlp]).toEqual([...ascii('FTLP'), 3, ...lap, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('lays out PENA bytes in declaration order', () => {
    expect([...body(SAMPLES[9]!).subarray(4, 12)]).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
  });
  it('writes FLBK frame id as u32 LE', () => {
    expect([...body({ code: 'FLBK', flashbackFrameIdentifier: 0x01020304, flashbackSessionTime: 0 }).subarray(4, 8)]).toEqual([4, 3, 2, 1]);
  });
  it('ignores bytes past the variant when reading', () => {
    const buf = new Uint8Array([...ascii('BUTN'), 1, 0, 0, 0, ...Array(8).fill(0xff)]);
    expect(readEventBody(new DataView(buf.buffer), 0)).toEqual({ ok: true, details: { code: 'BUTN', buttonStatus: 1 } });
  });
  it('reads at an offset (the code starts at byte 29 of the packet)', () => {
    const buf = new Uint8Array(45);
    writeEventBody(new DataView(buf.buffer), 29, { code: 'STLG', numLights: 3 });
    expect([...buf.subarray(29, 34)]).toEqual([...ascii('STLG'), 3]);
    expect(readEventBody(new DataView(buf.buffer), 29)).toEqual({ ok: true, details: { code: 'STLG', numLights: 3 } });
  });
  it('reports an unknown code instead of throwing', () => {
    const buf = new Uint8Array([...ascii('ABCD'), ...Array(12).fill(0)]);
    expect(readEventBody(new DataView(buf.buffer), 0)).toEqual({ ok: false, code: 'ABCD' });
  });
});
