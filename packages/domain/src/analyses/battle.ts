// Value types of the `battle` analysis (spec 6.3, A.3). Numbers only, no "can pass".
import type { VisualCompound } from '../compounds.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Joules, Ms } from '../units.ts';

/** The car ahead of or behind one of our cars. */
export type BattleSide = {
  carId: CarId;
  /** The gap to that car as `gaps.intervals` gives it (`toAheadMs` / `toBehindMs`, unsigned); displays sign it by side. */
  gapMs: Known<Ms>;
  /** Positive = the gap shrinks. */
  closingMsPerLap: Known<number>;
  lapsToDrs: Known<number>;
  /** Positive = we are faster. */
  paceDeltaMs: Known<Ms>;
  /** `paceDeltaMs` minus the overtaking threshold. */
  overtakeMarginMs: Known<Ms>;
  ours: { compound: VisualCompound; age: number };
  theirs: { compound: VisualCompound; age: number };
  theirErsStoreJ: Known<Joules>;
};

/** `battle.cards`: one of our cars against the car ahead and the car behind; `notApplicable` where there is none. */
export type BattleCard = { carId: CarId; ahead: Known<BattleSide>; behind: Known<BattleSide> };
