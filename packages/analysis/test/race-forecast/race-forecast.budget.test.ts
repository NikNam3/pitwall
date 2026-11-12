// `race-forecast`'s budget (SP4.3a spec 10, Task 18 row 10): one drawn scenario on a 20-car, 70-lap start, under 1.5 ms
// from lap 1 and under 0.6 ms from lap 35. Each pass times a batch of scenarios; the best pass's mean per scenario counts,
// after warm passes, so machine load cannot flake it (docs/testing.md 6).
import type { Policy } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { drawn, NOISY, PACE_MS, startingPoint } from './start.ts';

const CARS = 20;
const LAPS = 70;
const WARM = 3;
const PASSES = 10;
const BATCH = 20;

/** The long race's field: 20 cars 1.5 s apart, 150 ms a lap apart, AI noise, one stop each (laps 25 to 34), soft to medium. */
const stopLap = (car: number): number => 25 + (car % 10);
/** From lap 1 on fresh softs; from lap 35 on mediums fitted at each car's stop, every stop made. */
const field = (lap: number) =>
  startingPoint({
    lap,
    lapsTotal: LAPS,
    cars: Array.from({ length: CARS }, (_, i) => {
      const tyreAge = lap === 1 ? 0 : lap - 1 - stopLap(i);
      return { ...NOISY, gapMs: 1_500 * i, paceMs: PACE_MS + 150 * i, degMsPerLap: 20, compound: lap === 1 ? ('soft' as const) : ('medium' as const), tyreAge, wearPct: 2 * tyreAge, fuelKg: 100 - 1.4 * (lap - 1) };
    }),
    ours: [0, 1],
  });
const policiesFrom = (lap: number): Policy[] => Array.from({ length: CARS }, (_, i) => ({ stops: lap === 1 ? [{ lap: stopLap(i), compound: 'medium' }] : [] }));

/** The best pass's mean time per scenario, in ms. */
function bestMs(lap: number): number {
  const start = field(lap);
  const policies = policiesFrom(lap);
  const pass = (k: number): number => {
    const t0 = performance.now();
    for (let s = 0; s < BATCH; s++) raceForecast(start, policies, drawn(k * BATCH + s), createRng(1));
    return (performance.now() - t0) / BATCH;
  };
  for (let k = 0; k < WARM; k++) pass(k);
  let best = Infinity;
  for (let k = WARM; k < WARM + PASSES; k++) best = Math.min(best, pass(k));
  console.info(`[race-forecast budget] from lap ${lap}: best ${best.toFixed(3)} ms a scenario`);
  return best;
}

describe('race-forecast budget', () => {
  it('budget: one scenario from lap 1 under 1.5 ms, from lap 35 under 0.6 ms', () => {
    expect(bestMs(1)).toBeLessThan(1.5);
    expect(bestMs(35)).toBeLessThan(0.6);
  });
});
