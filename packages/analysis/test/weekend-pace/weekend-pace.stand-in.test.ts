// `weekend-pace`'s declared stand-in (SP4.3e Task 6, spec §4.4 item 7, planner report 6g; contract C3, C43, C47): a
// car with no long run and no valid qualifying lap takes the field's median qualifying-derived pace (best +
// `raceTrimOffsetMs`) plus `noPaceStandInOffsetMs` (config, C47), with `qualifyingPaceSdMs`, marked `source: 'standIn'`
// (C3: declared, never a silent 0). weekend-pace owns pre-race pace (C43).
//
// Rows (plan Task 6 Step 1): 1 stand-in, 2 config.
import { carId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { WEEKEND_PACE_CONFIG } from '../../src/index.ts';
import { basisOf, calc, qualiLap, qualifying, seats, valueOf, viewOf } from './support.ts';

const { raceTrimOffsetMs, qualifyingPaceSdMs } = WEEKEND_PACE_CONFIG.defaults;

const CARS = 20;
/** The car without pace: no long run, only an invalid qualifying lap (faster than every valid one). */
const WITHOUT = 13;
/** The median of the 19 other cars' qualifying-derived paces. */
const MEDIAN_MS = 99_728;
/** The stand-in: the median plus the default `noPaceStandInOffsetMs` of 1 s. */
const STAND_IN_MS = 100_728;

/** The 19 other cars' qualifying-derived paces: 150 ms apart around `MEDIAN_MS` (the 10th of 19 is the median). */
const PACES: Record<number, number> = Object.fromEntries(
  Array.from({ length: CARS }, (_, k) => k)
    .filter((k) => k !== WITHOUT)
    .map((k, rank) => [k, MEDIAN_MS + (rank - 9) * 150]),
);

/** A qualifying of the 20 cars: each other car's best is its pace less `raceTrimOffsetMs`, plus a slower lap; car 13's only lap is invalid. */
function field() {
  const laps = Object.entries(PACES).flatMap(([car, pace]) => [qualiLap(Number(car), 1, pace - raceTrimOffsetMs + 700), qualiLap(Number(car), 2, pace - raceTrimOffsetMs)]);
  laps.push(qualiLap(WITHOUT, 1, 80_000, false));
  return basisOf([qualifying('q', laps, seats(CARS))]);
}

describe('weekend-pace: a declared stand-in for a car without pace (SP4.3e Task 6)', () => {
  it("1. stand-in: 20 cars, car 13 without a long run or a valid qualifying lap, the others' median 99,728 ms → car 13 { paceMs: 100_728, source: 'standIn', sdMs: qualifyingPaceSdMs }", () => {
    const out = calc.compute(viewOf({ seats: seats(CARS), basis: field() }));
    // precondition: the other cars' paces are their qualifying-derived ones, their median 99,728 ms
    const sorted = Object.values(PACES).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBe(MEDIAN_MS);
    for (const [car, pace] of Object.entries(PACES)) {
      const own = valueOf(out, Number(car));
      expect(own.source, `car ${car}`).toBe('qualifying');
      expect(own.paceMs, `car ${car}`).toBe(pace);
    }
    // car 13: declared stand-in (C3), never insufficientData once the field has qualifying evidence
    expect(out[carId(WITHOUT)]?.known, 'car 13 has a pace').toBe(true);
    expect(valueOf(out, WITHOUT)).toMatchObject({ paceMs: STAND_IN_MS, source: 'standIn', sdMs: qualifyingPaceSdMs });
  });

  it('2. config: noPaceStandInOffsetMs defaults to 1000 ms and is read through view.config (C47)', () => {
    expect((WEEKEND_PACE_CONFIG.defaults as Record<string, unknown>)['noPaceStandInOffsetMs']).toBe(1000);
    const config = { 'weekend-pace': { noPaceStandInOffsetMs: 2500 } };
    const out = calc.compute(viewOf({ seats: seats(CARS), basis: field(), config }));
    expect(valueOf(out, WITHOUT)).toMatchObject({ paceMs: MEDIAN_MS + 2500, source: 'standIn', sdMs: qualifyingPaceSdMs });
  });
});
