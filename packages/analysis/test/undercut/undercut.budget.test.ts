// `undercut`'s budget (SP4.3b spec §9.1, §11.2; plan 4.3b2 Task 7 row 11; Global Constraints "caps are counts"): on
// the long-race builder (70 laps, 20 cars) at lap 1 (the first frame the starting point is known: the leader has
// completed lap 1), each of our cars has four rivals in range, so 12 cases at the config's `maxScenarioPolicies`
// (2,400); one car's run, its one DP solve included, under 300 ms. The cap is a count (C2): a miss lowers the count,
// never raises the budget. Best of warm passes (docs/testing.md).
import type { CarId } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { UNDERCUT_CONFIG, UNDERCUT_JOB, type UndercutInput } from '../../src/undercut/index.ts';
import { run } from '../../src/undercut/job.ts';
import { rejoinOf } from './support.ts';
import { OURS, viewAt } from '../strategy/support.ts';

const CAR_MS = 300;

describe('undercut budget', () => {
  // row 11
  it('budget: 12 cases with maxScenarioPolicies 2400 under 300 ms per car, one DP solve per car included', () => {
    expect(UNDERCUT_CONFIG.defaults.maxScenarioPolicies).toBe(2_400);
    const raw = viewAt(longRace(), 2, { frameOfLap: 0 });
    const at = raw.live.sessionTime;
    const outputs = new Map(raw.outputs);
    outputs.set('rejoin', { cars: Object.fromEntries(OURS.map((c) => [c, rejoinOf(c, at)])), ghost: {} });
    const input: UndercutInput = structuredClone(UNDERCUT_JOB.prepare({ ...raw, outputs }));

    const out = run(structuredClone(input), createRng(7));
    for (const car of OURS) {
      const v = out[car as CarId];
      expect(v?.known, `car ${car}`).toBe(true);
      if (!v?.known) continue;
      expect(v.value.rivals, `car ${car}`).toHaveLength(4);
      expect(v.value.rivals.flatMap((r) => r.cases), `car ${car}`).toHaveLength(12);
    }

    // one pass runs both our cars: the per-car time is the pass's over the cars
    let best = Infinity;
    for (let k = 0; k < 2; k++) run(structuredClone(input), createRng(k));
    for (let k = 0; k < 5; k++) {
      const copy = structuredClone(input);
      const t0 = performance.now();
      run(copy, createRng(100 + k));
      best = Math.min(best, performance.now() - t0);
    }
    expect(best / OURS.length).toBeLessThan(CAR_MS);
  }, 120_000);
});
