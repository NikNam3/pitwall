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
  /** Measured lap-time loss through `pace-delta`; `insufficientData` until two pace laps after the jump. */
  lossMsPerLap: Known<Ms>;
};

/** `damage.car`: the car's damage now, its faults and its jumps. */
export type DamageState = {
  parts: Known<DamageParts>;
  corners: Corners<{ tyrePct: Known<Percent>; brakePct: Known<Percent> }>;
  drsFault: Known<boolean>;
  ersFault: boolean;
  jumps: DamageJump[];
};
