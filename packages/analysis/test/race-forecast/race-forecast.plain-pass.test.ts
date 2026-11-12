// SP4.3b Task 11f (U9 Q3 C fix 1; C43, C50): a plain forecast is the distribution's mode, not a draw, so a pass it
// predicts must be likelier than not: in plain mode a held car passes only when its pace advantage exceeds
// `PLAIN_PASS_MIN_ADVANTAGE_MS` (1,500 ms a lap, `race-forecast/constants.ts`); below it, it stays behind however long
// it is held. The drawn (Monte Carlo) branch is unchanged: a held car with any advantage draws its pass at every
// braking zone with the pass curve's chance.
//
// The field of every row (built by hand, `start.ts`): A leads on the line at lap 1; B is `minGapMs` (500 ms) behind it,
// so held from its first braking zone (lap 1, 0.1), and `u` ms a lap faster. DRS is enabled from lap 3, so laps 1 and 2
// are DRS-free. `FITTED` is the curve the position diagnosis found (level −2.6 there; −3 here, slope ~0.001/ms, cap 0.6).
import type { PassCurve, StartingPoint } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { passChance, raceForecast } from '../../src/race-forecast/index.ts';
import { drawn, interaction, noStops, PACE_MS, PLAIN, startingPoint } from './start.ts';

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const FITTED: Partial<PassCurve> = { level: -3, slopePerMs: 0.001, cap: 0.6, drsFactor: 1.2 };
/** A curve under which today's plain mode passes at the first braking zone for any advantage of 1 s or more. */
const EASY: Partial<PassCurve> = { level: 0, slopePerMs: 0.01, cap: 1, drsFactor: 0 };

const held = (u: number, curve: Partial<PassCurve>): StartingPoint =>
  startingPoint({ lap: 1, lapsTotal: 20, cars: [{ gapMs: 0, paceMs: PACE_MS }, { gapMs: 500, paceMs: PACE_MS - u }], interaction: interaction({ curve, minGapMs: 500 }) });

/** The lap B first completes ahead of A (Infinity when it never does) up to `toLap`. */
const firstPassLap = (start: StartingPoint, scenario = PLAIN, toLap = 5): number => {
  const r = raceForecast(start, noStops(2), scenario, createRng(scenario.id), { trace: true, toLap });
  return r.trace!.find((t) => t.position[1] === 1)?.lap ?? Infinity;
};

describe('race-forecast: plain-mode passes (SP4.3b Task 11f)', () => {
  // row 1
  it('plain mode: a held car 1,000 ms a lap faster does not pass within 5 laps', () => {
    for (const curve of [FITTED, EASY]) {
      const r = raceForecast(held(1_000, curve), noStops(2), PLAIN, createRng(0), { trace: true, toLap: 5 });
      expect(r.trace!.map((t) => t.lap)).toEqual(range(1, 5));
      for (const t of r.trace!) expect(Array.from(t.position)).toEqual([1, 2]);
      expect(Array.from(r.position)).toEqual([1, 2]);
    }
  });

  // row 2
  it('plain mode: a held car 2,000 ms a lap faster passes', () => {
    // FITTED: p = 0.6·σ(−1) ≈ 0.16 a zone, summed hazard ln 2 by the fourth zone (lap 1, 0.8); EASY: the first zone
    for (const curve of [FITTED, EASY]) {
      expect(firstPassLap(held(2_000, curve))).toBe(1);
      const r = raceForecast(held(2_000, curve), noStops(2), PLAIN, createRng(0), { toLap: 5 });
      expect(Array.from(r.position)).toEqual([2, 1]);
    }
  });

  // row 3
  it('drawn scenarios are unchanged: the same seed gives the same draws and passes as before for a car 1,000 ms faster', () => {
    const start = held(1_000, FITTED);
    // the same seed gives the same forecast
    const a = raceForecast(start, noStops(2), drawn(7), createRng(7), { trace: true, toLap: 5 });
    const b = raceForecast(start, noStops(2), drawn(7), createRng(7), { trace: true, toLap: 5 });
    expect(b).toEqual(a);

    // the pass laps of scenarios 1–30 as the simulator drew them before Task 11f (pinned at the test commit)
    const before = [1, 4, 4, 2, 1, 3, 2, 2, 2, 3, 1, 1, 2, Infinity, 4, 1, Infinity, 4, 3, Infinity, 5, 5, 1, 1, 3, Infinity, 1, 2, 2, Infinity];
    expect(range(1, 30).map((id) => firstPassLap(start, drawn(id)))).toEqual(before);

    // and they are the pass curve's draws: one per braking zone (four a lap) at p = passChance(FITTED, dry, no DRS, 1 s)
    // on the DRS-free laps 1 and 2; across 2,000 scenarios the share passed by each lap's end within 4 standard errors
    const p = passChance({ wetFactor: 1, ...FITTED } as PassCurve, false, false, 1_000);
    const N = 2_000;
    const laps = range(1, N).map((id) => firstPassLap(start, drawn(id), 2));
    for (const lap of [1, 2]) {
      const expected = 1 - (1 - p) ** (4 * lap);
      const share = laps.filter((l) => l <= lap).length / N;
      expect(Math.abs(share - expected)).toBeLessThanOrEqual(4 * Math.sqrt((expected * (1 - expected)) / N));
    }
  });
});
