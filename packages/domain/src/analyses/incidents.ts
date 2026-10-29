// Value types of the `incidents` analysis (spec 6.4, A.3).
import type { CarId, SessionTime } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

export type IncidentKind = 'collision' | 'retirement' | 'damage' | 'timeLoss' | 'warning' | 'penalty' | 'neutralised';

/**
 * What an incident changed for one of our cars, from the mini-sector history before and after. A position is
 * `notReceived` while our car has no crossing at that moment. The gaps are to `otherCarId` (positive = we are behind
 * it): `notApplicable` when the entry has no other car (then `otherCarId` is too), and `gapAfterMs` also when that car
 * retired by the after moment.
 */
export type IncidentForUs = {
  ourCarId: CarId;
  /** The incident's car the gaps are measured to: the first of its cars that is not ours. */
  otherCarId: Known<CarId>;
  positionBefore: Known<number>;
  positionAfter: Known<number>;
  gapBeforeMs: Known<Ms>;
  gapAfterMs: Known<Ms>;
};

/** One entry of `incidents.feed` (newest first); it updates as its time lost resolves. */
export type IncidentEntry = {
  /** Stable across updates: kind + cars + session time. */
  id: string;
  at: SessionTime;
  lap: number;
  kind: IncidentKind;
  /** Which kinds are major is config. */
  severity: 'major' | 'minor';
  carIds: CarId[];
  /** From the mini-sector at once, then from `pace-delta` once there are laps. */
  timeLostMs: Known<Ms>;
  forUs: IncidentForUs[];
};
