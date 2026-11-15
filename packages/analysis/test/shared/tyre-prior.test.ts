// The game's tyre prior (SP4.3c spec §5.2, plan Task 12; research 22 §1.1–1.2, §1.6): the shared pure functions
// `degradation` and `tyre-model` both import, so the two units never read each other (no cycle).
import { describe, expect, it } from 'vitest';
import { gameLossMsPerPct, gamePriorRatePct } from '../../src/shared/tyre-prior.ts';

describe('shared/tyre-prior', () => {
  it('gamePriorRatePct = k × limitPct / usableLifeLaps: AI 0.86 × 70 / 28 = 2.15 %/lap; a human 1.3 × 70 / 28', () => {
    expect(gamePriorRatePct(28, 0.86, 70)).toBeCloseTo(2.15, 9);
    expect(gamePriorRatePct(28, 1.3, 70)).toBeCloseTo(3.25, 9);
    expect(gamePriorRatePct(28, 1.19, 70)).toBeCloseTo((1.19 * 70) / 28, 9);
    // scale-free in k: twice the usable life, half the rate (research 22 §1.3, the race-distance setting)
    expect(gamePriorRatePct(56, 0.86, 70)).toBeCloseTo(1.075, 9);
  });

  it('gameLossMsPerPct = (fitted delta − fresh delta) / wear: 0 and −1,140 ms at 20 % → 57 ms/%; −1,500 ms → 75 ms/%', () => {
    expect(gameLossMsPerPct(0, -1_140, 20)).toBeCloseTo(57, 9);
    expect(gameLossMsPerPct(0, -1_500, 20)).toBeCloseTo(75, 9);
    // the fitted set's delta need not be 0 (a delta against another fitted set)
    expect(gameLossMsPerPct(200, -940, 20)).toBeCloseTo(57, 9);
  });

  it('below minWearForLossPct (8 %) the delta is noise: undefined', () => {
    expect(gameLossMsPerPct(0, -1_140, 6)).toBeUndefined();
    expect(gameLossMsPerPct(0, -1_140, 0)).toBeUndefined();
    expect(gameLossMsPerPct(0, -456, 8)).toBeCloseTo(57, 9);
  });

  it('is pure: the same inputs give the same output', () => {
    expect(gamePriorRatePct(28, 0.86, 70)).toBe(gamePriorRatePct(28, 0.86, 70));
    expect(gameLossMsPerPct(0, -1_140, 20)).toBe(gameLossMsPerPct(0, -1_140, 20));
  });
});
