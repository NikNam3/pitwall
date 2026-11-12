// `race-monte-carlo`'s cap (SP4.3b spec §7.3, Task 19; C2): a count of scenario-policies, never a clock. Every
// scenario-policy is at least one `race-forecast` run (spec §7.1: scenarios run through `raceForecast`), so the runs
// counted here bound the scenario-policies from above: at most the cap, re-scoring included.
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it, vi } from 'vitest';
import type * as forecast from '../../src/race-forecast/index.ts';
import { raceMonteCarlo } from '../../src/race-monte-carlo/index.ts';
import { NOISY, startingPoint } from '../race-forecast/start.ts';
import { carOf, hazard, mcInput, stopAt } from './support.ts';

const runs = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../src/race-forecast/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof forecast>();
  return {
    ...real,
    raceForecast: (...args: Parameters<typeof real.raceForecast>) => {
      runs.n++;
      return real.raceForecast(...args);
    },
  };
});

describe('race-monte-carlo: the cap', () => {
  // row 12
  it('the cap is held: the run never evaluates more than maxScenarioPolicies scenario-policies (re-scoring included)', () => {
    // both our cars (slots 2 and 3), four one-stop candidates each, close together in a noisy field
    const start = startingPoint({ lapsTotal: 8, cars: Array.from({ length: 6 }, (_, i) => ({ ...NOISY, retireRate: 0, gapMs: 1_500 * i })), ours: [2, 3] });
    const candidates = { 2: [stopAt(3), stopAt(4), stopAt(5), stopAt(4, 'medium')], 3: [stopAt(3, 'medium'), stopAt(4, 'medium'), stopAt(5, 'medium'), stopAt(5)] };
    const hz = hazard(8, { sc: { 2: 0.1, 4: 0.1 }, vsc: { 3: 0.1 } });
    for (const cap of [500, 1_000]) {
      runs.n = 0;
      const result = raceMonteCarlo(mcInput(start, candidates, { hazard: hz, config: { maxScenarioPolicies: cap } }), createRng(71), cap);
      expect(runs.n).toBeGreaterThan(0);
      expect(runs.n).toBeLessThanOrEqual(cap);
      for (const car of [2, 3]) expect(carOf(result, car).scenarios).toBeLessThanOrEqual(cap);
      // close candidates are not separated within so few: the run stops at the cap and says so
      expect(carOf(result, 2).capHit || carOf(result, 3).capHit).toBe(true);
    }
  });
});
