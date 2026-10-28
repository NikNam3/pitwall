import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { initialState, step } from '../../src/index.ts';
import { sessionKindOf } from '../../src/step/session.ts';
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
    expect(s).toMatchObject({ trackId: 3, sessionType: 15, kind: 'race', totalLaps: 57, trackLengthM: 5412, sector2StartM: 1800.5, sector3StartM: 3600.25,
      durationMs: 7_200_000, timeLeftMs: 7_000_000, pitSpeedLimitKmh: 80, weather: 'lightRain', trackTempC: 31, airTempC: 24, flag: 'vsc',
      networkGame: true, forecastAccuracy: 'approximate', periods: { sc: 1, vsc: 0, red: 0 }, link: { weekend: 77 }, numActiveCars: 0, updatedAt: 12500 });
    expect(s.marshalZones).toEqual([{ startFraction: 0.125, flag: 'yellow' }, { startFraction: 0.5, flag: 'unknown' }]);
    expect(s.forecast).toEqual([{ sessionType: 15, offsetMin: 5, weather: 'heavyRain', trackTempC: 30, trackTempTrend: 'down', airTempC: 23,
      airTempTrend: 'flat', rainPct: 60 }, expect.objectContaining({ offsetMin: 10, weather: 'storm' })]);
    expect(s.settings).toMatchObject({ tyreTemperature: 'surfaceOnly', safetyCar: 'increased', redFlags: 'reduced', carDamage: 'standard',
      carDamageRate: 'simulation', lowFuelMode: 'hard', recoveryMode: 'flashbacks', flashbackLimit: 'unlimited', surfaceType: 'realistic',
      collisions: 'playerToPlayerOff', pitLaneTyreSim: true, parcFerme: true });
  });
  it.each([[0, 'unknown'], [1, 'practice'], [4, 'practice'], [5, 'qualifying'], [9, 'qualifying'], [10, 'sprintShootout'], [14, 'sprintShootout'],
    [15, 'race'], [17, 'race'], [18, 'timeTrial'], [19, 'unknown']] as const)('sessionType %i is %s', (code, kind) => expect(sessionKindOf(code)).toBe(kind));
  it('initialState: 22 cars by id, player from the header, unknown data, empty history', () => {
    const st = initialState({ feedId, sessionUid: 0xb3cd07e2790bdcben, session: buildPacket('session', { header: { playerCarIndex: 4, frameIdentifier: 9 } }) });
    expect(st.cars.map((c) => c.id)).toEqual([...Array(22).keys()]);
    expect([st.feedId, st.sessionUid, st.playerCar, st.teammateCar, st.lastFrameId]).toEqual([feedId, '12956020372289608894', 4, undefined, 9]);
    expect(Object.values(st.history).every((h) => h.length === 0)).toBe(true);
    expect(st.cars[4]!.ownCar).toEqual({ motionEx: nr, setup: nr, brakeBiasPct: nr });
    expect([st.cars[3]!.ownCar, st.cars[3]!.energy.fuel, st.cars[3]!.active]).toEqual([undefined, nr, false]);
  });
  it('step updates the session only on frames with a Session packet', () => {
    const fs = new ScenarioBuilder({ cars: 2 }).frames(2, () => {}).session({ totalLaps: 5, safetyCarStatus: 1 }).frames(1, () => {}).build();
    const st = initialState({ feedId, sessionUid: fs[0]!.sessionUid, session: fs[0]!.session! });
    expect(fs.map((f) => step(st, f).changed.has('session'))).toEqual([true, false, true]);
    expect([st.session.totalLaps, st.session.flag, st.session.numActiveCars, st.lastFrameId, st.sessionTime]).toEqual([5, 'sc', 2, 2, 32]);
  });
});
