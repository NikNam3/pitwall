// Value types of the `battle` analysis (spec 6.3, A.3). Numbers only, no "can pass".
import type { VisualCompound } from '../compounds.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { DrsOffReason } from '../situations/race-control-race.ts';
import type { Joules, Ms } from '../units.ts';

/** The car ahead of or behind one of our cars. */
export type BattleSide = {
  carId: CarId;
  /** The gap to that car as `gaps.intervals` gives it (`toAheadMs` / `toBehindMs`, unsigned); displays sign it by side. */
  gapMs: Known<Ms>;
  /**
   * From PACE Δ (`paceDeltaMs`): (gap − `race-interaction`'s `drsRangeMs`) / the closing car's edge per lap, on this side while its car
   * closes; 0 inside DRS range; `notApplicable` while the gap is not closing or race control has DRS off
   * (`BattleCard.drs`); PACE Δ's reason while it is unknown.
   */
  lapsToDrs: Known<number>;
  /** Over the same last 50 mini-sectors of both cars, s/lap; positive = we are faster. */
  paceDeltaMs: Known<Ms>;
  /**
   * The margin that applies on this side: `pass` ahead (our edge − `overtakeThresholdMs`), `hold` behind
   * (`overtakeThresholdMs` − their edge); positive = good for us.
   */
  margin: Known<{ kind: 'pass' | 'hold'; ms: Ms }>;
  /**
   * The pass chance (0–1) at the current gap from `race-interaction`'s pass curve (SP4.3c O13): ahead ours to pass, behind
   * theirs to pass us. Replaces `margin`, which Task 15 deletes; unfilled until then.
   */
  passChance: Known<number>;
  ours: { compound: VisualCompound; age: number };
  theirs: { compound: VisualCompound; age: number };
  theirErsStoreJ: Known<Joules>;
};

/** Why race control has DRS off: the race-control span detail's reason. */
export type { DrsOffReason };

/** Whether race control allows DRS now, from the game's DRSE and DRSD events. */
export type DrsStatus = { enabled: true } | { enabled: false; reason: DrsOffReason };

/** `battle.cards`: one of our cars against the car ahead and the car behind; `notApplicable` where there is none. */
export type BattleCard = { carId: CarId; ahead: Known<BattleSide>; behind: Known<BattleSide>; drs: DrsStatus };
