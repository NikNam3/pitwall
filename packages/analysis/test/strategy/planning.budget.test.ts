// The planning job's budget (SP4.3d2 Task 9 row 6; SP4.3d spec §8 "the planning job inside the strategy job's budget
// per car"; C51): on the long-race builder (70 laps, 20 cars) recast as the ended qualifying session
// (`./planning-support.ts`), the race's laps entered as 70, five prepared slots per car (A, B, C, G1, G2, each with a
// start compound; A active), each car's part at the config's `maxScenarioPolicies` within the strategy job's per-part
// budget (`JOB_MS` of `strategy.budget.test.ts`, 7 s; ruling R29) single thread. The cap is
// a count (C2): a miss lowers the count, never raises the budget. Best of warm passes (docs/testing.md).
import { IMPORTED, type CarId, type Policy, type Slot } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { planningInputFrom } from '../../src/shared/strategy-input/index.ts';
import { runStrategy, STRATEGY_CONFIG } from '../../src/strategy/index.ts';
import { planningParts, qualifyingAsOf, type PreparedRound } from './planning-support.ts';
import { LONG_RACE_OURS_SETS, OURS } from './support.ts';

const LAPS = 70;
/**
 * One car's part of the planning job: the strategy job's `JOB_MS` (`strategy.budget.test.ts`), mirrored; spec §8 "the
 * planning job inside the strategy job's budget per car" (R29).
 */
const PART_MS = 7_000;

/** Five prepared slots, each from the start: its start compound and its stops. */
const SLOTS: Record<Slot, Policy> = {
  A: { startCompound: 'medium', stops: [{ lap: 30, compound: 'hard' }] },
  B: { startCompound: 'soft', stops: [{ lap: 18, compound: 'hard' }, { lap: 46, compound: 'medium' }] },
  C: { startCompound: 'hard', stops: [{ lap: 40, compound: 'medium' }] },
  G1: { startCompound: 'soft', stops: [{ lap: 20, compound: 'hard' }, { lap: 45, compound: 'soft' }] },
  G2: { startCompound: 'soft', stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'hard' }, { lap: 50, compound: 'soft' }] },
};

describe('planning budget (SP4.3d2 Task 9)', () => {
  it('6: budget: five slots per car, each car\'s part within the strategy job\'s 7 s on the long-race builder', () => {
    const cap = STRATEGY_CONFIG.defaults.maxScenarioPolicies;
    const asOf = qualifyingAsOf(longRace(), { laps: LAPS, sets: LONG_RACE_OURS_SETS, config: { maxScenarioPolicies: cap } });
    const prepared = Object.fromEntries(OURS.map((car) => [car, { saved: { ...SLOTS }, active: 'A' }])) as PreparedRound;
    const input = structuredClone(planningInputFrom(asOf, { laps: LAPS, race: { laps: LAPS, sets: 'carried', conditions: IMPORTED }, prepared }));
    expect(input.start.known, input.start.known ? '' : input.start.reason).toBe(true);
    const parts = planningParts().split(input);
    expect(parts.map((p) => p.planCar), 'one part per our car').toEqual([...OURS]);
    for (const part of parts) {
      const car = part.planCar as CarId;
      let best = Infinity;
      let out: ReturnType<typeof runStrategy> | undefined;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        out = runStrategy(structuredClone(part), createRng(7));
        // the first pass warms
        if (k > 0) best = Math.min(best, performance.now() - t0);
      }
      const entry = out?.[car];
      expect(entry?.known, `car ${car}`).toBe(true);
      const rows = entry?.known ? entry.value.rows : [];
      expect(rows.filter((r) => r.slot !== null).map((r) => r.slot).sort(), `car ${car}: its five slots are rows`).toEqual(['A', 'B', 'C', 'G1', 'G2']);
      console.info(`[planning budget] car ${car}'s part with five slots ${best.toFixed(0)} ms at cap ${cap} (long race as qualifying, ${LAPS} laps)`);
      expect(best, `car ${car}'s part`).toBeLessThan(PART_MS);
    }
  }, 240_000);
});
