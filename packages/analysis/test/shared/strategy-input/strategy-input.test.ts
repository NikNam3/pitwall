// The shared strategy input (SP4.3b2 Task 6 rows 2 and 5; C43): `strategy`'s job conversions moved to
// `shared/strategy-input/` keep their values. Row 2 compares them with the snapshot of 4.3b1's job (`./former.ts`,
// `former-values.json`, written from `candidatesForRun` before the move); row 5 the config's key mapping (plan Global
// Constraints: Agreement).
import type { CarId, Policy } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { mcSettingsFrom, policyOf, strategyInputFrom, toDpInput, toMcHazard } from '../../../src/shared/strategy-input/index.ts';
import { strategyDp, type DpInput } from '../../../src/strategy-dp/index.ts';
import { STRATEGY_CONFIG } from '../../../src/strategy/config.ts';
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
      expect(plainValue(dp), `car ${car}: DP input`).toEqual(dpInput);
      const result = strategyDp(dp);
      expect(policyOf(result.plans[0] ?? result.stayOut, result.thresholds), `car ${car}: policy`).toEqual(policy);
    }
    expect(plainValue(toMcHazard(input.hazard))).toEqual(former.hazard);
    expect(mcSettingsFrom(input.config)).toEqual(former.settings);
  });

  // row 5
  it('mcSettingsFrom maps rivalScBoxChance, rivalScMinTyreAge, rivalReactionLaps and parses points', () => {
    const set = mcSettingsFrom({ [STRATEGY_CONFIG.key]: { rivalScBoxChance: 0.5, rivalScMinTyreAge: 7, rivalReactionLaps: 2, points: '10, 6,3 ,1', zTie: 3, tieBand: 0.1 } });
    expect(set).toEqual({ rivalRules: { q: 0.5, aMin: 7, reactionLaps: 2, coverRule: false }, points: [10, 6, 3, 1], zTie: 3, tieBand: 0.1 });
    // without a section: the config's defaults
    const d = STRATEGY_CONFIG.defaults;
    expect(mcSettingsFrom({})).toEqual({
      rivalRules: { q: d.rivalScBoxChance, aMin: d.rivalScMinTyreAge, reactionLaps: d.rivalReactionLaps, coverRule: false },
      points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
      zTie: d.zTie,
      tieBand: d.tieBand,
    });
  });
});
