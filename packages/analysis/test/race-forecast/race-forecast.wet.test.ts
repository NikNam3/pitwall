// `race-forecast` reads `wet`, the one wet rule (SP4.3c Task 14 row 4, O3; C43): the pass chance's `wetFactor` applies
// on a wet track only, by `track-wetness`'s rule (wetness − wetSigmas · sd > 0), never by the simulator's own
// `wetnessMs > 0` test (deleted). A starting point with wetness +200 ± 400 ms is not wet, so the curve's `wetFactor`
// changes nothing; a track at 2,000 ± 400 ms is wet, so it does.
//
// How the test hands the rule over (the test agent's reading, Task 14 report): the starting point's wetness carries
// the rule's verdict as `wetness.wet` (filled where the starting point is built, from `track-wetness`'s `wet`); a
// simulator that instead applies the rule to the starting point's wetness and sd gives the same verdicts here.
import type { PassCurve, StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { drawn, interaction, noStops, PACE_MS, startingPoint } from './start.ts';

/** A curve that passes often enough for a wet factor to show: a car 1.5 s a lap faster, close behind. */
const CURVE: Partial<PassCurve> = { level: -1, slopePerMs: 0.002, cap: 0.7, drsFactor: 0 };

/** Two cars, B 1.5 s a lap faster 600 ms behind, over 12 laps; the curve's `wetFactor` and the track's wetness as given. */
function battle(wetFactor: number, wetness: { wetnessMs: number; sdMs: number; wet: boolean }): StartingPoint {
  const start = startingPoint({ lap: 1, lapsTotal: 12, cars: [{ gapMs: 0, paceMs: PACE_MS, sigmaMs: 150 }, { gapMs: 600, paceMs: PACE_MS - 1_500, sigmaMs: 150 }], interaction: interaction({ curve: { ...CURVE, wetFactor } }) });
  start.wetness = wetness as StartingPoint['wetness'];
  return start;
}

/** The forecast of `start` over 40 drawn scenarios: per scenario the positions and race times at the flag. */
const run = (start: StartingPoint): unknown[] =>
  Array.from({ length: 40 }, (_, i) => {
    const r = raceForecast(start, noStops(2), drawn(i + 1), createRng(i + 1));
    return [Array.from(r.position), Array.from(r.raceTimeMs)];
  });

describe('race-forecast: the pass chance reads `wet` (row 4)', () => {
  it('wetness +200 ± 400 ms is not wet: the curve`s wetFactor changes nothing', () => {
    const notWet = { wetnessMs: 200, sdMs: 400, wet: false };
    expect(run(battle(0.3, notWet))).toStrictEqual(run(battle(1, notWet)));
  });

  it('a wet track (2,000 ± 400 ms) scales the pass chance by wetFactor', () => {
    const wet = { wetnessMs: 2_000, sdMs: 400, wet: true };
    expect(run(battle(0.3, wet))).not.toStrictEqual(run(battle(1, wet)));
  });
});
