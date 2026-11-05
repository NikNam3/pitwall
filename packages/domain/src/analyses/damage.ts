// Value types of the `damage` analysis (spec 5.5, A.1, A.3); `DamageParts` is shared with `LapRecord.damageAtEnd`.
import type { Corners } from '../corners.ts';
import type { SessionTime } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms, Percent } from '../units.ts';

/** Damage per part of the car. */
export type DamageParts = {
  frontLeftWingPct: Percent;
  frontRightWingPct: Percent;
  rearWingPct: Percent;
  floorPct: Percent;
  diffuserPct: Percent;
  sidepodPct: Percent;
  gearboxPct: Percent;
  enginePct: Percent;
};

/** `damageChange` events within `jumpWindowMs` that add up to at least `jumpPct`. */
export type DamageJump = {
  at: SessionTime;
  lap: number;
  parts: (keyof DamageParts)[];
  deltaPct: Percent;
  /** Measured lap-time loss through `pace-delta`; `notApplicable` with fewer than two pace laps before the jump (it can never be measured); otherwise `insufficientData` until two pace laps after it. */
  lossMsPerLap: Known<Ms>;
  /** While the loss is being measured over the pace laps after the jump (`lapsNeeded` 2); `notApplicable` otherwise. */
  measuring: Known<{ lapsDone: number; lapsNeeded: number }>;
  /**
   * Estimated loss from the car's mini-sectors since the jump against its segment medians frozen at the jump, scaled to
   * 50 segments, after at least `minEstimateSegments`; `notApplicable` once `lossMsPerLap` is known. A jump whose loss
   * can never be measured keeps its estimate.
   */
  estimateMsPerLap: Known<Ms>;
};

/** `damage.car`: the car's damage now, its faults and its jumps. */
export type DamageState = {
  parts: Known<DamageParts>;
  corners: Corners<{ tyrePct: Known<Percent>; brakePct: Known<Percent> }>;
  drsFault: Known<boolean>;
  ersFault: boolean;
  jumps: DamageJump[];
};
