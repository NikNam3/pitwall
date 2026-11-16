// `race-forecast` with per-compound tyre terms (SP4.3c Task 12, spec §5.2 "Deletes": the per-car tyre terms in
// `race-forecast/field.ts` go; `StartingPoint.tyre` holds each car's terms per compound, `tyreIndex(car, compound)`):
// after a stop the car takes the new compound's wear rate and degradation, not the start compound's. One car alone (no
// interaction), the plain scenario, a lap model whose only tyre term is `degMsPerLap × wear` (no convex term, no cold
// tyres), so a green lap on a set is the one before plus `deg × rate` of the compound fitted.
import type { Policy } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { PLAIN, startingPoint, traceAt, type CarSpec } from './start.ts';

const LAPS = 14;
const STOP_LAP = 5;
const stopToHard: Policy[] = [{ stops: [{ lap: STOP_LAP, compound: 'hard' }], triggers: [] }];

/** The lap times of the single car, laps 1 to `LAPS`, starting on mediums at age 0. */
function lapTimes(car: CarSpec): number[] {
  const start = startingPoint({ lap: 1, lapsTotal: LAPS, cars: [{ compound: 'medium', tyreAge: 0, wearPct: 0, ...car }] });
  const r = raceForecast(start, stopToHard, PLAIN, createRng(1), { trace: true });
  return Array.from({ length: LAPS }, (_, i) => traceAt(r, i + 1).lapTimeMs[0]!);
}

/** Successive differences of `times` from lap `from` to lap `to` (1-based, inclusive). */
const steps = (times: number[], from: number, to: number): number[] => times.slice(from - 1, to).map((t, i, a) => (i === 0 ? 0 : t - a[i - 1]!)).slice(1);

describe('race-forecast: a stop fits the new compound`s terms (Task 12)', () => {
  const medium = { wearRatePct: 2, degMsPerLap: 10 };
  const hard = { wearRatePct: 0.5, degMsPerLap: 100 };

  it('on mediums each green lap is 2 %/lap × 10 ms/% = 20 ms slower; after the stop to hards 0.5 × 100 = 50 ms', () => {
    const times = lapTimes({ tyre: { medium, hard } });
    for (const d of steps(times, 2, STOP_LAP - 1)) expect(d).toBeCloseTo(medium.wearRatePct * medium.degMsPerLap, 6);
    // from the second lap on the new set (its out lap is lap STOP_LAP + 1)
    for (const d of steps(times, STOP_LAP + 2, LAPS)) expect(d).toBeCloseTo(hard.wearRatePct * hard.degMsPerLap, 6);
  });

  it('changing only the hard`s terms changes nothing before the stop and the laps after it', () => {
    const base = lapTimes({ tyre: { medium, hard } });
    const otherHard = lapTimes({ tyre: { medium, hard: { wearRatePct: 1.5, degMsPerLap: 40 } } });
    expect(otherHard.slice(0, STOP_LAP - 1)).toEqual(base.slice(0, STOP_LAP - 1));
    expect(otherHard.slice(STOP_LAP + 1)).not.toEqual(base.slice(STOP_LAP + 1));
  });

  it('changing only the medium`s terms leaves the laps on the hard set as they were', () => {
    const base = lapTimes({ tyre: { medium, hard } });
    const otherMedium = lapTimes({ tyre: { medium: { wearRatePct: 4, degMsPerLap: 30 }, hard } });
    expect(steps(otherMedium, STOP_LAP + 2, LAPS)).toEqual(steps(base, STOP_LAP + 2, LAPS));
    expect(otherMedium.slice(1, STOP_LAP - 1)).not.toEqual(base.slice(1, STOP_LAP - 1));
  });
});
