// `degradation`'s filter prior from the game's tyre sets (SP4.3c Task 12, research 22 §1.6, §2), fix round 2 (C43):
// the fresh set a stint's loss per % is read against is picked by the one shared rule, `bestFreshSet` of
// `shared/tyre-prior.ts` (tyre-model's), never by a copy in degradation; the limit, the AI's k and the loss threshold
// are `tyre-model`'s config. The shared module is spied (its real functions run) to see degradation call the pick.
import { known, type LapRecord, type TyreSet } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import * as prior from '../../src/shared/tyre-prior.ts';
import { TYRE_MODEL_CONFIG } from '../../src/tyre-model/config.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { guardedQuick, situatedView } from '../situated.ts';
import { tyreSet } from '../tyre-model/support.ts';
import { stintLaps } from './support.ts';

/** The real `bestFreshSet`, once the mock factory has loaded the module. */
const shared = vi.hoisted(() => ({ real: undefined as ((...a: unknown[]) => unknown) | undefined }));
/** Calls the real pick. */
const callReal = (...a: unknown[]): unknown => shared.real?.(...a);

vi.mock('../../src/shared/tyre-prior.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  shared.real = actual['bestFreshSet'] as ((...a: unknown[]) => unknown) | undefined;
  return { ...actual, bestFreshSet: vi.fn((...a: unknown[]) => callReal(...a)) };
});

const calc = guardedQuick(degradationCalculator);
const { aiWearFactor, limitPct } = TYRE_MODEL_CONFIG.defaults;

/** Laps 1–3 of car 0 on a medium C3, every lap carrying `sets` (the game's sets as the lap record holds them). */
function viewWith(sets: TyreSet[]): EngineView {
  const laps: LapRecord[] = stintLaps({ from: 1, to: 3, visual: 'medium', actual: 'C3' }).map((l) => ({ ...l, tyreSets: known(sets, l.completedAt) }));
  return situatedView({ cars: [carState()], history: { laps } });
}

/** The start prior's ν of car 0's first stint. */
const startNu = (view: EngineView): number => {
  const stint = Object.values(calc.compute(view))[0]?.[0];
  if (stint === undefined) throw new Error('no stint');
  return stint.startPrior.nuMsPerLap;
};

/** The spied pick. */
const pick = (): Mock => (prior as unknown as { bestFreshSet: Mock }).bestFreshSet;

describe('degradation: the game prior through the shared fresh-set pick (fix round 2, C43)', () => {
  beforeEach(() => {
    pick().mockReset();
    pick().mockImplementation((...a: unknown[]) => callReal(...a));
  });

  it('ν starts at the game`s loss per % (fitted against bestFreshSet`s set) × k · limit / usableLife; degradation calls bestFreshSet', () => {
    const sets = [
      tyreSet('medium', { fitted: true, wearPct: 20, usableLifeLaps: 28, lapDeltaMs: 0 }),
      // the fastest fresh medium: −1,140 ms → 57 ms/% at 20 %
      tyreSet('medium', { lapDeltaMs: -1_140 }),
      // faster, but no fresh set (worn, unavailable): the shared rule leaves them out
      tyreSet('medium', { wearPct: 3, lapDeltaMs: -3_000 }),
      tyreSet('medium', { available: false, lapDeltaMs: -2_500 }),
      // another compound
      tyreSet('soft', { lapDeltaMs: -4_000 }),
    ];
    expect(startNu(viewWith(sets))).toBeCloseTo(57 * ((aiWearFactor * limitPct) / 28), 6);
    expect(pick()).toHaveBeenCalled();
    // asked for the fitted set's compound over the lap record's sets
    expect(pick().mock.calls.some((c: unknown[]) => c[1] === 'medium' && Array.isArray(c[0]) && (c[0] as unknown[]).length === sets.length)).toBe(true);
  });

  it('the start follows the shared pick: what bestFreshSet returns is the set the loss is read against', () => {
    const sets = [tyreSet('medium', { fitted: true, wearPct: 20, usableLifeLaps: 28, lapDeltaMs: 0 }), tyreSet('medium', { lapDeltaMs: -1_140 }), tyreSet('medium', { lapDeltaMs: -1_500 })];
    // the real pick: −1,500 → 75 ms/%
    expect(startNu(viewWith(sets))).toBeCloseTo(75 * ((aiWearFactor * limitPct) / 28), 6);
    // the pick made to return the slower set (as tyre-model's rule does with the game's fitted index on the faster
    // one): degradation follows it, so the rule is the shared one alone
    pick().mockImplementation((s: readonly TyreSet[]) => s[1]);
    expect(startNu(viewWith(sets))).toBeCloseTo(57 * ((aiWearFactor * limitPct) / 28), 6);
  });
});
