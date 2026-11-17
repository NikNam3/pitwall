// The shared strategy input's start compound (SP4.3d2 Task 8, spec §7.2; C43, C50): the DP's input per car carries
// `startCompound` (`null` where the grid start leaves it free, `start.freeCompound[car] = 1`; else the car's fitted
// compound), and `policyOf`, the one builder of a candidate's policy, carries a free start's `startCompound`.
import { carId, NOISE_COMPOUNDS } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { dpInputOn } from '../../../src/shared/strategy-input/dp-input.ts';
import { policyOf } from '../../../src/shared/strategy-input/index.ts';
import type { DpPlan } from '../../../src/strategy-dp/index.ts';
import { startingPoint } from '../../race-forecast/start.ts';
import { oneWorld } from './worlds.ts';

const hazard = { byLap: new Float64Array(30), vscByLap: new Float64Array(30), scDur: Float64Array.from([1]), vscDur: Float64Array.from([1]), active: null };

describe("the shared strategy input's start compound (SP4.3d2 Task 8)", () => {
  it('the DP input of a car with a free start compound has startCompound null; every other car its compound', () => {
    const field = startingPoint({ lapsTotal: 30, cars: [{ compound: 'soft' }, { gapMs: 2_000, compound: 'hard' }], ours: [0, 1] });
    const grid = { ...field, start: { freeCompound: Uint8Array.from([1, 0]), odds: [null, null] } };
    expect(dpInputOn(grid, carId(0), hazard, oneWorld(grid), 1_000).startCompound).toBeNull();
    expect(dpInputOn(grid, carId(1), hazard, oneWorld(grid), 1_000).startCompound).toBe('hard');
    // inside the race (`start: null`) every car is on its tyres
    for (const car of [0, 1]) expect(dpInputOn(field, carId(car), hazard, oneWorld(field), 1_000).startCompound).toBe(NOISE_COMPOUNDS[field.compound[car]!]);
  });

  it("policyOf carries a free start's startCompound, and none where the plan has none", () => {
    const free: DpPlan = { startCompound: 'soft', stops: [{ lap: 12, compound: 'hard' }], expectedMs: 1, world: 0 };
    expect(policyOf(free)).toStrictEqual({ startCompound: 'soft', stops: [{ lap: 12, compound: 'hard' }] });
    const onTyres: DpPlan = { stops: [{ lap: 12, compound: 'hard' }], expectedMs: 1, world: 0 };
    expect(policyOf(onTyres)).toStrictEqual({ stops: [{ lap: 12, compound: 'hard' }] });
  });
});
