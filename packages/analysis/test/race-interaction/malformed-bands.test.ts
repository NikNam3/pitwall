// F12-1 (C3, ruling R37): `difficultyBands` can come from the user's `config.json`, so a malformed spec is an expected
// problem, not a bug: the calculator and the priors aggregate fall back to the config's default bands and never throw.
import { carId, currentLaps, known } from '@pitwall/domain';
import type { EngineView, StoredSource } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceInteractionCalculator } from '../../src/race-interaction/calculator.ts';
import { passLevelKey, passSlopeKey, RACE_INTERACTION_CONFIG, RACE_INTERACTION_PRIORS } from '../../src/race-interaction/index.ts';
import { guardedQuick } from '../situated.ts';
import { laps, projectionOf, raceView, scene, TRACK, type Scene } from './scene.ts';

const calc = guardedQuick(raceInteractionCalculator);
const KEY = RACE_INTERACTION_CONFIG.key;
const MALFORMED = ['0-79;80', '', 'a-b'] as const;

/** A config record whose `difficultyBands` is `spec`. */
const configWith = (spec: string): EngineView['config'] => ({ [KEY]: { ...RACE_INTERACTION_CONFIG.defaults, difficultyBands: spec } });

/** Car 1 starts 0.4 s behind car 0 and gains 0.1 s a lap. */
const CHASE: Scene = scene([
  { car: 0, startAt: 0, lapTimes: laps(8, 90_000) },
  { car: 1, startAt: 400, lapTimes: laps(8, 89_900) },
]);

describe('race-interaction survives a malformed difficultyBands (F12-1, C3)', () => {
  it.each(MALFORMED)('a malformed difficultyBands (%j) gives the default bands, no throw: the calculator', (spec) => {
    const expected = calc.compute(raceView(CHASE));
    expect(expected.bands.map(({ fromDifficulty, toDifficulty }) => [fromDifficulty, toDifficulty])).toEqual([
      [0, 79],
      [80, 110],
    ]);
    const out = calc.compute({ ...raceView(CHASE), config: configWith(spec) });
    expect(out).toEqual(expected);
  });

  it.each(MALFORMED)('a malformed difficultyBands (%j) gives the default bands, no throw: the priors aggregate', (spec) => {
    const sessionLaps = currentLaps(CHASE.laps);
    const source: StoredSource = {
      source: { sessionUid: '1', weekendId: 'w1', feedCar: carId(0), car: carId(1), firstLap: 1, excludedLaps: [] },
      phase: { kind: 'race', format: 'grandPrix' },
      stint: { carId: carId(1), firstLap: 1, lastLap: 8, actualCompound: 'C3', visualCompound: 'soft', tyreAgeAtFitting: 0, frame: 0 },
      laps: sessionLaps.filter((l) => l.carId === carId(1)),
      pitStops: CHASE.pitStops,
      sessionLaps,
      track: known(TRACK, 0),
      aiDifficulty: known(62, 0),
      projection: projectionOf(CHASE),
    };
    const defaults = { config: {}, overrides: {} };
    const malformed = { config: configWith(spec), overrides: {} };
    for (const key of [passLevelKey(0), passSlopeKey(0), passLevelKey(1), passSlopeKey(1)]) {
      const entry = RACE_INTERACTION_PRIORS.entries[key]!;
      const expected = entry.aggregate!([source], defaults);
      expect(entry.aggregate!([source], malformed), key).toEqual(expected);
      expect(entry.samples!([source], malformed), key).toEqual(entry.samples!([source], defaults));
    }
    // band 0 holds the source's episodes under the default bands: the fallback is the default split, not one band
    expect(RACE_INTERACTION_PRIORS.entries[passLevelKey(0)]!.aggregate!([source], malformed).known).toBe(true);
    expect(RACE_INTERACTION_PRIORS.entries[passLevelKey(1)]!.aggregate!([source], malformed).known).toBe(false);
  });
});
