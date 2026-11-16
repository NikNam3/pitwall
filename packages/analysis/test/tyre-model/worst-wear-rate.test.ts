// The worst-corner pick (SP4.3c Task 25g, ruling R64, C43, C3): `tyre-model` exports its pick of a compound's wear rate
// at the worst corner as a pure function, and `forecast-field` calls it instead of its own copy. Known corners: the
// highest rate, known at the newest `at` of the four. Any unknown corner: the first unknown one's value (corner order
// FL, FR, RL, RR), its reason kept (C3). That the starting point's rates are unchanged is `forecast-field.test.ts`'
// "the tyre terms per car and compound are tyre-model's" (the rate at the worst corner per car and compound).
import { known, unknown, type Known, type TyreModelCompound, type TyreTerm } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { worstWearRate } from '../../src/tyre-model/index.ts';

const term = (value: Known<number>): TyreTerm<number> => ({ value, source: 'measured' });

/** A compound's terms with the four corners' wear rates; the other terms do not matter to the pick. */
const compound = (fl: Known<number>, fr: Known<number>, rl: Known<number>, rr: Known<number>): TyreModelCompound => ({
  wearRatePct: { fl: term(fl), fr: term(fr), rl: term(rl), rr: term(rr) },
  nuMsPerLap: term(known(40, 0)),
  lossMsPerPct: term(known(20, 0)),
  freshOffsetMs: term(known(0, 0)),
  lapsToLimit: known(30, 0),
});

describe("tyre-model's worst-corner pick (R64)", () => {
  it('four known rates: the highest, at the newest at of the four', () => {
    const got = worstWearRate(compound(known(1.5, 1000), known(2.25, 900), known(1.8, 4000), known(2.0, 2500)));
    expect(got).toEqual(known(2.25, 4000));
  });

  it('a tie: the rate once, at the newest at', () => {
    expect(worstWearRate(compound(known(2, 100), known(2, 300), known(1, 200), known(1, 50)))).toEqual(known(2, 300));
  });

  it("an unknown corner: the first unknown corner's value, its reason kept (C3)", () => {
    const got = worstWearRate(compound(known(9, 100), unknown('realism'), known(1, 200), unknown('insufficientData')));
    expect(got).toEqual(unknown('realism'));
    expect(worstWearRate(compound(known(1, 0), known(2, 0), known(3, 0), unknown('insufficientData')))).toEqual(unknown('insufficientData'));
  });

  it('every corner unknown: the front-left one', () => {
    expect(worstWearRate(compound(unknown('notApplicable'), unknown('realism'), unknown('realism'), unknown('realism')))).toEqual(unknown('notApplicable'));
  });
});
