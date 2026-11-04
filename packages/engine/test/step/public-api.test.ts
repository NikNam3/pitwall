import { describe, expect, it } from 'vitest';
import * as engine from '../../src/index.ts';
import { CHANGE_TAGS, initialState } from '../../src/index.ts';
import { buildPacket } from '../builders/index.ts';

describe('step public API', () => {
  it('the package index exports participantsValuesOf and no driver key rule (Task 27: a car is its team and race number)', () => {
    expect(typeof engine.participantsValuesOf).toBe('function');
    expect('driverKeyOf' in engine).toBe(false);
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
