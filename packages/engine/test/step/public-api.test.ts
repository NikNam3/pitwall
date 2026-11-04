import { describe, expect, it } from 'vitest';
import { CHANGE_TAGS, driverKeyOf, initialState } from '../../src/index.ts';
import { buildPacket } from '../builders/index.ts';

describe('step public API', () => {
  it('the package index exports the one driverKeyOf', () => {
    // Task 24 (user): a DriverKey is the name and the network id; a slot the packet lacks reads as no name on 255
    const p = buildPacket('participants', { participants: { 0: { aiControlled: 1, driverId: 9, name: 'NINE', networkId: 255 } } });
    expect(driverKeyOf(p, 0)).toEqual({ name: 'NINE', networkId: 255 });
    expect(driverKeyOf(p, 99)).toEqual({ name: '', networkId: 255 });
  });
  it('CHANGE_TAGS lists each tag once and is the source of ChangeTag', () => {
    expect(new Set(CHANGE_TAGS).size).toBe(CHANGE_TAGS.length);
    expect(CHANGE_TAGS).toEqual(expect.arrayContaining(['session', 'identity', 'timing', 'laps', 'miniSectors']));
  });
  it('an out-of-range trend or weather code reads as the first table entry', () => {
    const session = buildPacket('session', {
      numWeatherForecastSamples: 1,
      weatherForecastSamples: { 0: { trackTemperatureChange: 9, airTemperatureChange: 9, weather: 99 } },
    });
    expect(initialState({ feedId: 'f' as never, sessionUid: 1n, session }).session.forecast).toMatchObject([
      { trackTempTrend: 'up', airTempTrend: 'up', weather: 'clear' },
    ]);
  });
});
