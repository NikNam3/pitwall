import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { initialState, situationOf, step } from '../../src/index.ts';
import { carsInSessionOf } from '../../src/situations/car-status/in-session.ts';
import { buildPacket, ScenarioBuilder } from '../builders/index.ts';

const feedId = 'test' as FeedId;
const nr = { known: false, reason: 'notReceived' };
const packet = buildPacket('session', { header: { sessionTime: 12.5 }, weather: 3, trackTemperature: 31, airTemperature: 24, totalLaps: 57,
  trackLength: 5412, sessionType: 15, trackId: 3, sessionDuration: 7200, sessionTimeLeft: 7000, pitSpeedLimit: 80, safetyCarStatus: 2, networkGame: 1,
  numMarshalZones: 2, marshalZones: { 0: { zoneStart: 0.125, zoneFlag: 3 }, 1: { zoneStart: 0.5, zoneFlag: -1 } }, numWeatherForecastSamples: 2,
  weatherForecastSamples: { 0: { sessionType: 15, timeOffset: 5, weather: 4, trackTemperature: 30, trackTemperatureChange: 1, airTemperature: 23,
    airTemperatureChange: 2, rainPercentage: 60 }, 1: { sessionType: 15, timeOffset: 10, weather: 5 } }, forecastAccuracy: 1, weekendLinkIdentifier: 77,
  numSafetyCarPeriods: 1, tyreTemperature: 0, safetyCar: 3, redFlags: 1, carDamage: 2, carDamageRate: 2, lowFuelMode: 1, recoveryMode: 1,
  flashbackLimit: 3, surfaceType: 1, collisions: 1, pitLaneTyreSim: 0, parcFermeRules: 1, sector2LapDistanceStart: 1800.5, sector3LapDistanceStart: 3600.25 });

describe('session state', () => {
  it('maps the Session packet', () => {
    const s = initialState({ feedId, sessionUid: 9n, session: packet }).session;
    // Task 24 (C13): the session type, kind, flag, marshal zones, periods and numActiveCars are signals: `state.signals`
    expect(s).toMatchObject({ trackId: 3, totalLaps: 57, trackLengthM: 5412, sector2StartM: 1800.5, sector3StartM: 3600.25,
      durationMs: 7_200_000, timeLeftMs: 7_000_000, pitSpeedLimitKmh: 80, weather: 'lightRain', trackTempC: 31, airTempC: 24,
      networkGame: true, forecastAccuracy: 'approximate', link: { weekend: 77 }, updatedAt: 12500 });
    expect(initialState({ feedId, sessionUid: 9n, session: packet }).signals.session.marshalZones).toEqual([
      { startFraction: 0.125, flag: 'yellow' }, { startFraction: 0.5, flag: 'unknown' },
    ]);
    expect(s.forecast).toEqual([{ offsetMin: 5, weather: 'heavyRain', trackTempC: 30, trackTempTrend: 'down', airTempC: 23,
      airTempTrend: 'flat', rainPct: 60 }, expect.objectContaining({ offsetMin: 10, weather: 'storm' })]);
    expect(s.settings).toMatchObject({ tyreTemperature: 'surfaceOnly', safetyCar: 'increased', redFlags: 'reduced', carDamage: 'standard',
      carDamageRate: 'simulation', lowFuelMode: 'hard', recoveryMode: 'flashbacks', flashbackLimit: 'unlimited', surfaceType: 'realistic',
      collisions: 'playerToPlayerOff', pitLaneTyreSim: true, parcFerme: true });
  });
  it('initialState: 22 cars by id, player from the header, unknown data, empty history', () => {
    const st = initialState({ feedId, sessionUid: 0xb3cd07e2790bdcben, session: buildPacket('session', { header: { playerCarIndex: 4, frameIdentifier: 9 } }) });
    expect(st.cars.map((c) => c.id)).toEqual([...Array(22).keys()]);
    expect([st.feedId, st.sessionUid, st.playerCar, st.teammateCar, st.lastFrameId]).toEqual([feedId, '12956020372289608894', 4, undefined, 9]);
    const { spans, appendedAt, ...lists } = st.history;
    expect([...Object.values(lists), ...Object.values(spans), ...Object.values(appendedAt)].every((h) => h?.length === 0)).toBe(true);
    expect(st.cars[4]!.ownCar).toEqual({ motionEx: nr, setup: nr, brakeBiasPct: nr });
    // no car is in the session before car-status opened a span (Task 24: car-status, not `car.active`)
    expect([st.cars[3]!.ownCar, st.cars[3]!.energy.fuel, carsInSessionOf(situationOf(st).byMachine['car-status'])]).toEqual([undefined, nr, []]);
  });
  it('step updates the session only on frames with a Session packet', () => {
    const fs = new ScenarioBuilder({ cars: 2 }).frames(2, () => {}).session({ totalLaps: 5, safetyCarStatus: 1 }).frames(1, () => {}).build();
    const st = initialState({ feedId, sessionUid: fs[0]!.sessionUid, session: fs[0]!.session! });
    expect(fs.map((f) => step(st, f).changed.has('session'))).toEqual([true, false, true]);
    expect([st.session.totalLaps, st.signals.session.safetyCarStatus, st.signals.session.numActiveCars, st.lastFrameId, st.sessionTime]).toEqual([5, 'sc', 2, 2, 32]);
  });
  // Task 24 ruling 3 (C8, C13): the game sends the forecast of every session of the weekend, each sample with its session
  // type (a signal). Step 1 selects the values of this session; no sample keeps a session type.
  it("the forecast holds the samples of this session only, in the packet's order, without their session type", () => {
    const mixed = buildPacket('session', { sessionType: 15, numWeatherForecastSamples: 4, weatherForecastSamples: {
      0: { sessionType: 13, timeOffset: 0, weather: 1 }, 1: { sessionType: 15, timeOffset: 0, weather: 2 },
      2: { sessionType: 13, timeOffset: 5, weather: 3 }, 3: { sessionType: 15, timeOffset: 5, weather: 4 } } });
    const forecast = initialState({ feedId, sessionUid: 9n, session: mixed }).session.forecast;
    expect(forecast.map((f) => [f.offsetMin, f.weather])).toEqual([[0, 'overcast'], [5, 'heavyRain']]);
    expect(forecast.every((f) => !('sessionType' in f))).toBe(true);
  });
});

// SP4.3d2 Task 4 (spec §7.3, call 2; C8, C13): `nextForecast` holds the values of the samples whose session type is the
// one after this session's in the weekend structure, in the packet's order, mapped as `forecast` maps them. The session
// types choose the samples and are kept nowhere (C13).
/** A Session packet of `sessionType` in a weekend of `structure`, with two samples per listed session type (offsets 0 and 5, weather from 1). */
const weekendPacket = (structure: readonly number[], sessionType: number, sampleTypes: readonly number[]) => {
  const samples = sampleTypes.flatMap((type, i) => [
    { sessionType: type, timeOffset: 0, weather: (2 * i) % 6, trackTemperature: 20 + i, airTemperature: 15 + i, rainPercentage: 10 * i },
    { sessionType: type, timeOffset: 5, weather: (2 * i + 1) % 6, trackTemperature: 21 + i, airTemperature: 16 + i, rainPercentage: 10 * i + 5 },
  ]);
  return buildPacket('session', {
    sessionType, numSessionsInWeekend: structure.length, weekendStructure: Object.fromEntries(structure.map((t, i) => [i, t])),
    numWeatherForecastSamples: samples.length, weatherForecastSamples: Object.fromEntries(samples.map((s, i) => [i, s])),
  });
};
/** The session state from a Session packet. */
const sessionOf = (packet: ReturnType<typeof weekendPacket>) => initialState({ feedId, sessionUid: 9n, session: packet }).session;
/** The forecast of the session `type` in a packet of its own: the values `nextForecast` must hold. */
const forecastOfType = (structure: readonly number[], type: number, sampleTypes: readonly number[]) =>
  sessionOf(weekendPacket(structure, type, sampleTypes)).forecast;

describe("the next session's forecast (SP4.3d2 Task 4)", () => {
  const GP = [1, 5, 15] as const;
  const SPRINT = [1, 10, 15, 5, 16] as const;

  it('structure [1, 5, 15] at type 5 with samples of 5 and 15: nextForecast is the 15 samples', () => {
    const s = sessionOf(weekendPacket(GP, 5, [5, 15]));
    const expected = forecastOfType(GP, 15, [5, 15]);
    expect(expected).toHaveLength(2);
    expect(s.nextForecast).toEqual(expected);
    expect(s.nextForecast.map((f) => [f.offsetMin, f.weather, f.trackTempC, f.airTempC, f.rainPct])).toEqual([[0, 'overcast', 21, 16, 10], [5, 'lightRain', 22, 17, 15]]);
    // the forecast stays this session's
    expect(s.forecast.map((f) => [f.offsetMin, f.weather])).toEqual([[0, 'clear'], [5, 'lightCloud']]);
  });

  it('structure [1, 5, 15] at type 15: nextForecast is []', () => {
    const s = sessionOf(weekendPacket(GP, 15, [5, 15]));
    expect(s.nextForecast).toEqual([]);
    expect(s.forecast).toHaveLength(2);
  });

  it('sprint structure [1, 10, 15, 5, 16] at type 10: nextForecast is the 15 samples', () => {
    const types = [10, 15, 5, 16];
    const s = sessionOf(weekendPacket(SPRINT, 10, types));
    const expected = forecastOfType(SPRINT, 15, types);
    expect(expected).toHaveLength(2);
    expect(s.nextForecast).toEqual(expected);
  });

  it('sprint structure [1, 10, 15, 5, 16] at type 5: nextForecast is the 16 samples', () => {
    const types = [10, 15, 5, 16];
    const s = sessionOf(weekendPacket(SPRINT, 5, types));
    const expected = forecastOfType(SPRINT, 16, types);
    expect(expected).toHaveLength(2);
    expect(s.nextForecast).toEqual(expected);
    expect(s.nextForecast.every((f) => !('sessionType' in f))).toBe(true);
  });
});
