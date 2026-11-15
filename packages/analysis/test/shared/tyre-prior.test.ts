// The game's tyre prior (SP4.3c spec §5.2, plan Task 12; research 22 §1.1–1.2, §1.6): the shared pure functions
// `degradation` and `tyre-model` both import, so the two units never read each other (no cycle).
//
// Fix round 2 (C43, C47): the fresh-set pick (`bestFreshSet`) and the laps-to-limit rule (`lapsToLimitOf`) live here,
// one copy each; the module holds no copy of a config key (the limit 70 and the loss threshold 8 are `tyre-model`'s
// config, passed by the callers).
import { known, unknown, type TyreSet } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import * as prior from '../../src/shared/tyre-prior.ts';
import { bestFreshSet, gameLossMsPerPct, gamePriorRatePct, lapsToLimitOf } from '../../src/shared/tyre-prior.ts';
import { TYRE_MODEL_CONFIG } from '../../src/tyre-model/config.ts';
import { tyreSet } from '../tyre-model/support.ts';

const MIN_WEAR = TYRE_MODEL_CONFIG.defaults.minWearForLossPct;
const LIMIT = TYRE_MODEL_CONFIG.defaults.limitPct;

describe('shared/tyre-prior', () => {
  it('gamePriorRatePct = k × limitPct / usableLifeLaps: AI 0.86 × 70 / 28 = 2.15 %/lap; a human 1.3 × 70 / 28', () => {
    expect(gamePriorRatePct(28, 0.86, 70)).toBeCloseTo(2.15, 9);
    expect(gamePriorRatePct(28, 1.3, 70)).toBeCloseTo(3.25, 9);
    expect(gamePriorRatePct(28, 1.19, 70)).toBeCloseTo((1.19 * 70) / 28, 9);
    // scale-free in k: twice the usable life, half the rate (research 22 §1.3, the race-distance setting)
    expect(gamePriorRatePct(56, 0.86, 70)).toBeCloseTo(1.075, 9);
  });

  it('gameLossMsPerPct = (fitted delta − fresh delta) / wear: 0 and −1,140 ms at 20 % → 57 ms/%; −1,500 ms → 75 ms/%', () => {
    expect(gameLossMsPerPct(0, -1_140, 20, MIN_WEAR)).toBeCloseTo(57, 9);
    expect(gameLossMsPerPct(0, -1_500, 20, MIN_WEAR)).toBeCloseTo(75, 9);
    // the fitted set's delta need not be 0 (a delta against another fitted set)
    expect(gameLossMsPerPct(200, -940, 20, MIN_WEAR)).toBeCloseTo(57, 9);
  });

  it('below minWearPct (tyre-model`s minWearForLossPct, 8 %) the delta is noise: undefined', () => {
    expect(gameLossMsPerPct(0, -1_140, 6, MIN_WEAR)).toBeUndefined();
    expect(gameLossMsPerPct(0, -1_140, 0, MIN_WEAR)).toBeUndefined();
    expect(gameLossMsPerPct(0, -456, 8, MIN_WEAR)).toBeCloseTo(57, 9);
    // the threshold is the caller's: 5 % lets a 6 % set count
    expect(gameLossMsPerPct(0, -342, 6, 5)).toBeCloseTo(57, 9);
  });

  it('is pure: the same inputs give the same output', () => {
    expect(gamePriorRatePct(28, 0.86, 70)).toBe(gamePriorRatePct(28, 0.86, 70));
    expect(gameLossMsPerPct(0, -1_140, 20, MIN_WEAR)).toBe(gameLossMsPerPct(0, -1_140, 20, MIN_WEAR));
  });

  describe('fix round 2: no copy of a config key (C47)', () => {
    it('exports no limit and no loss threshold of its own: GAME_LIFE_LIMIT_PCT and MIN_WEAR_FOR_LOSS_PCT are gone', () => {
      expect(prior).not.toHaveProperty('GAME_LIFE_LIMIT_PCT');
      expect(prior).not.toHaveProperty('MIN_WEAR_FOR_LOSS_PCT');
    });

    it('gameLossMsPerPct takes its threshold as a required parameter (no default: four declared parameters)', () => {
      expect(gameLossMsPerPct.length).toBe(4);
    });
  });

  describe('fix round 2: bestFreshSet, the one fresh-set pick (C43)', () => {
    it('the fastest (smallest delta) available, unfitted, new set of the compound', () => {
      const sets: TyreSet[] = [
        tyreSet('medium', { fitted: true, wearPct: 20 }),
        tyreSet('medium', { lapDeltaMs: -900 }),
        tyreSet('medium', { lapDeltaMs: -1_140 }),
        tyreSet('hard', { lapDeltaMs: -2_000 }),
      ];
      expect(bestFreshSet(sets, 'medium')?.lapDeltaMs).toBe(-1_140);
      expect(bestFreshSet(sets, 'hard')?.lapDeltaMs).toBe(-2_000);
    });

    it('a worn, an unavailable or a fitted set is no fresh set; none of the compound → undefined', () => {
      const sets: TyreSet[] = [
        tyreSet('medium', { fitted: true, lapDeltaMs: -5_000 }),
        tyreSet('medium', { wearPct: 4, lapDeltaMs: -4_000 }),
        tyreSet('medium', { available: false, lapDeltaMs: -3_000 }),
        tyreSet('medium', { lapDeltaMs: -800 }),
      ];
      expect(bestFreshSet(sets, 'medium')?.lapDeltaMs).toBe(-800);
      expect(bestFreshSet(sets, 'soft')).toBeUndefined();
      expect(bestFreshSet([tyreSet('medium', { fitted: true })], 'medium')).toBeUndefined();
    });

    it('with the live state`s fittedIdx: the set at that index is no fresh set even when its `fitted` flag is false (tyre-model`s rule)', () => {
      // the game's fitted index names set 1, whose flag says otherwise: only tyre-model's rule leaves it out
      const sets: TyreSet[] = [tyreSet('medium', { lapDeltaMs: -700 }), tyreSet('medium', { lapDeltaMs: -1_500 })];
      expect(bestFreshSet(sets, 'medium', 1)?.lapDeltaMs).toBe(-700);
      // without an index (a lap record's sets) the flag alone decides
      expect(bestFreshSet(sets, 'medium')?.lapDeltaMs).toBe(-1_500);
    });
  });

  describe('fix round 2: lapsToLimitOf, the one laps-to-limit rule (C43)', () => {
    it('(limit − wear) / rate, at the later of the two times', () => {
      expect(lapsToLimitOf(known(11, 1_000), known(2, 3_000), LIMIT)).toEqual(known(29.5, 3_000));
      expect(lapsToLimitOf(known(10, 5_000), known(2, 3_000), 80)).toEqual(known(35, 5_000));
      // a fresh set: from 0 % wear
      expect(lapsToLimitOf(known(0, 0), known(2.5, 90_000), LIMIT)).toEqual(known(28, 90_000));
    });

    it('0 at or past the limit, also with an unknown or zero rate', () => {
      expect(lapsToLimitOf(known(70, 1_000), known(2, 0), LIMIT)).toEqual(known(0, 1_000));
      expect(lapsToLimitOf(known(76, 1_000), unknown('notReceived'), LIMIT)).toEqual(known(0, 1_000));
      expect(lapsToLimitOf(known(70, 1_000), known(0, 0), LIMIT)).toEqual(known(0, 1_000));
    });

    it('unknown while the wear or the rate is unknown, with its reason (C3); a rate of 0 or less → insufficientData', () => {
      expect(lapsToLimitOf(unknown('realism'), known(2, 0), LIMIT)).toEqual(unknown('realism'));
      expect(lapsToLimitOf(known(10, 0), unknown('restricted'), LIMIT)).toEqual(unknown('restricted'));
      expect(lapsToLimitOf(known(10, 0), known(0, 0), LIMIT)).toEqual(unknown('insufficientData'));
      expect(lapsToLimitOf(known(10, 0), known(-1, 0), LIMIT)).toEqual(unknown('insufficientData'));
    });
  });
});
