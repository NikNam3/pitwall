// The shared strategy input (SP4.3b2 Task 6 rows 2 and 5; C43): `strategy`'s job conversions moved to
// `shared/strategy-input/` keep their values. Row 2 compares them with the snapshot of 4.3b1's job (`./former.ts`,
// `former-values.json`, written from `candidatesForRun` before the move); row 5 the config's key mapping (plan Global
// Constraints: Agreement).
import type { CarId, Policy } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { GAPS } from '../../../src/gaps/index.ts';
import { mcSettingsFrom, policyOf, STRATEGY_INPUT_READS, strategyInputFrom, toDpInput, toMcHazard } from '../../../src/shared/strategy-input/index.ts';
import { gapsOf, withGaps } from '../../gaps/output.ts';
import { solveDp, type DpInput } from '../../../src/strategy-dp/index.ts';
import { STRATEGY_CONFIG } from '../../../src/strategy/config.ts';
import { RACE_INTERACTION_CONFIG } from '../../../src/race-interaction/config.ts';
import { RACE, viewAt } from '../../strategy/support.ts';
import FORMER from './former-values.json' with { type: 'json' };
import { plainValue, SNAPSHOT_LAP } from './former.ts';

type Former = {
  cars: { car: CarId; dpInput: unknown; policy: Policy }[];
  hazard: unknown;
  settings: { rivalRules: unknown; points: number[]; zTie: number; tieBand: number };
};
const former = FORMER as unknown as Former;

describe('shared strategy input', () => {
  // row 2
  it("toDpInput, toMcHazard, policyOf and mcSettingsFrom give strategy's former values on the builder race", () => {
    const input = structuredClone(strategyInputFrom(viewAt(RACE(), SNAPSHOT_LAP)));
    expect(former.cars.map((c) => c.car)).toEqual(input.ourCars);
    for (const { car, dpInput, policy } of former.cars) {
      const dp: DpInput = toDpInput(input, car);
      // ported (SP4.3d2 Task 8): the input gained `startCompound`, inside the race the car's own compound; the rest as before
      const { startCompound, ...rest } = dp;
      expect(startCompound, `car ${car}: on its tyres`).toBe(dp.carParams.compound);
      expect(plainValue(rest), `car ${car}: DP input`).toEqual(dpInput);
      const result = solveDp(dp);
      // the best plan, a stop list (SP4.3d spec §5.1); the snapshot holds no triggers
      expect(policyOf(result.plans[0] ?? result.continue), `car ${car}: policy`).toEqual(policy);
    }
    expect(plainValue(toMcHazard(input.hazard))).toEqual(former.hazard);
    expect(mcSettingsFrom(input.config)).toEqual(former.settings);
  });

  // row 5
  it('mcSettingsFrom maps rivalScBoxChance, rivalScMinTyreAge, rivalReactionLaps and parses points', () => {
    const set = mcSettingsFrom({ [STRATEGY_CONFIG.key]: { rivalScBoxChance: 0.5, rivalScMinTyreAge: 7, rivalReactionLaps: 2, points: '10, 6,3 ,1', zTie: 3, tieBand: 0.1 } });
    expect(set).toEqual({ rivalRules: { q: 0.5, aMin: 7, reactionLaps: 2, coverRule: false, coverGapMs: 3_000 }, points: [10, 6, 3, 1], zTie: 3, tieBand: 0.1 });
    // without a section: the config's defaults
    const d = STRATEGY_CONFIG.defaults;
    expect(mcSettingsFrom({})).toEqual({
      rivalRules: { q: d.rivalScBoxChance, aMin: d.rivalScMinTyreAge, reactionLaps: d.rivalReactionLaps, coverRule: false, coverGapMs: RACE_INTERACTION_CONFIG.defaults.closeGapMs },
      points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
      zTie: d.zTie,
      tieBand: d.tieBand,
    });
  });

  it("the live build's order is gaps' (SP4.3c Task 13, R34, O10): the strategy input reads gaps and passes its output to forecast-field", () => {
    expect(STRATEGY_INPUT_READS).toContainEqual({ calculator: GAPS });
    const view = viewAt(RACE(), SNAPSHOT_LAP);
    const gaps = gapsOf(view);
    expect(gaps.intervals.length, 'gaps orders the field').toBeGreaterThan(3);
    // gaps' order with its 2nd and 3rd car swapped: the starting point follows it
    const intervals = [...gaps.intervals];
    [intervals[1], intervals[2]] = [intervals[2]!, intervals[1]!];
    const input = strategyInputFrom(withGaps(view, { ...gaps, intervals }));
    expect(input.start.known).toBe(true);
    if (input.start.known) expect(Array.from(input.start.value.order).slice(0, intervals.length)).toEqual(intervals.map((i) => i.carId));
  });

  it("one close gap (SP4.3c Task 3, C43, C47): the cover rule's gap is race-interaction's closeGapMs, filled by mcSettingsFrom; a strategy ruleGapMs is not read", () => {
    expect(RACE_INTERACTION_CONFIG.defaults.closeGapMs).toBe(3_000);
    expect(mcSettingsFrom({ [RACE_INTERACTION_CONFIG.key]: { closeGapMs: 1_750 } }).rivalRules.coverGapMs).toBe(1_750);
    expect(mcSettingsFrom({ [STRATEGY_CONFIG.key]: { ruleGapMs: 1_750 } }).rivalRules.coverGapMs).toBe(3_000);
  });
});
