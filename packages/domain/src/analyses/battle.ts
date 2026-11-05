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
  /**
   * From PACE Δ (`paceDeltaMs`): (gap − `drsRangeMs`) / the closing car's edge per lap, on this side while its car
   * closes; 0 inside DRS range; `notApplicable` while the gap is not closing or race control has DRS off
   * (`BattleCard.drs`); PACE Δ's reason while it is unknown.
   */
  lapsToDrs: Known<number>;
  /** Over the same last 50 mini-sectors of both cars, s/lap; positive = we are faster. */
  paceDeltaMs: Known<Ms>;
  /** The margin to pass of the car that would pass: ahead, our pace delta minus the threshold; behind, theirs (−`paceDeltaMs` − the threshold). */
  overtakeMarginMs: Known<Ms>;
  /**
   * The margin that applies on this side: `pass` ahead (our edge − `overtakeThresholdMs`), `hold` behind
   * (`overtakeThresholdMs` − their edge); positive = good for us.
   */
  margin?: Known<{ kind: 'pass' | 'hold'; ms: Ms }>;
  ours: { compound: VisualCompound; age: number };
  theirs: { compound: VisualCompound; age: number };
  theirErsStoreJ: Known<Joules>;
};

/** Why race control has DRS off: the game's DRSD reasons, `notEnabledYet` before a race's first DRSE, `unknown` for a reason code we don't know. */
export type DrsOffReason = 'notEnabledYet' | 'wetTrack' | 'safetyCar' | 'redFlag' | 'minLapNotReached' | 'unknown';

/** Whether race control allows DRS now, from the game's DRSE and DRSD events. */
export type DrsStatus = { enabled: true } | { enabled: false; reason: DrsOffReason };

/** `battle.cards`: one of our cars against the car ahead and the car behind; `notApplicable` where there is none. */
export type BattleCard = { carId: CarId; ahead: Known<BattleSide>; behind: Known<BattleSide>; drs: DrsStatus };
