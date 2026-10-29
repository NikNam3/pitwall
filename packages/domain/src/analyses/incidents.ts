// Value types of the `incidents` analysis (spec 6.4, A.3).
import type { DamageParts } from './damage.ts';
import type { CarId, SessionTime } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms, Percent } from '../units.ts';

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

/**
 * Where on the lap an incident happened, for its first car: the sector from the car's lap distance between its
 * mini-sector crossings (`notApplicable` for an entry without a car, `notReceived` before the car has a crossing or
 * the session its sector distances). F1 25 sends no turn numbers, only lap distance: a `turn` needs per-track corner
 * data and goes beside `sector` once there is some.
 */
export type IncidentWhere = { sector: Known<1 | 2 | 3> };

/** One part of a damage entry and how much it rose, in percentage points. */
export type IncidentDamagePart = { part: keyof DamageParts; deltaPct: Percent };

/**
 * A warning's place on the way to the next penalty: warning `count` of `limit` (`2/3`). Assumes a penalty every
 * `limit` warnings (not verified against the game).
 */
export type IncidentWarning = { count: number; limit: number };

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
  where: IncidentWhere;
  /** Damage entries only: the parts that rose, the biggest rise first. */
  damage?: IncidentDamagePart[];
  /** Warning entries only. */
  warning?: IncidentWarning;
};
