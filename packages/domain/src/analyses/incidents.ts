// Value types of the `incidents` analysis (spec 6.4, A.3).
import type { DamageParts } from './damage.ts';
import type { CarId, SessionTime } from '../ids.ts';
import type { Known } from '../known.ts';
import type { LapFraction, MapPoint } from '../track-file.ts';
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
 * the session its sector distances); `fraction`, where the car was on the lap at the incident's time; `turn`, the turn
 * whose apex is nearest that fraction (spec 6.2). `turn` and `fraction` are optional until the `incidents` analysis
 * computes them.
 */
export type IncidentWhere = { sector: Known<1 | 2 | 3>; turn?: Known<string>; fraction?: Known<LapFraction> };

/** `incidents.markers`: one major incident on the track map, at its point on the outline. */
export type MapIncident = { point: MapPoint; kind: IncidentKind };

/** One part of a damage entry and how much it rose, in percentage points. */
export type IncidentDamagePart = { part: keyof DamageParts; deltaPct: Percent };

/**
 * A warning by its kind: `cornerCutting` when the warned span's `cornerCutting` count rose, with its place on the way
 * to the next penalty, warning `count` of `limit` (`2/3`; assumes a penalty every `limit` warnings, not verified
 * against the game); `other` otherwise, with its PENA infringement code (`infringement`).
 */
export type IncidentWarning = { kind: 'cornerCutting'; count: number; limit: number } | { kind: 'other'; infringement: Known<number> };

/** A penalty's ruling, from the PENA `penaltyType` codes the shared penalty classes count as penalties. */
export type PenaltyKind = 'driveThrough' | 'stopGo' | 'grid' | 'time' | 'disqualified' | 'tyreRegulations';

/** A penalty entry's penalty: its kind, its time for a time penalty, and the infringement its record names (unknown without one, C3). */
export type IncidentPenalty = { kind: PenaltyKind; timeMs?: Ms; infringement?: Known<number> };

/**
 * What caused a `neutralised` entry: the entry it names, with that entry's kind, cars and time copied so the display
 * renders the line without looking another entry up (C65).
 */
export type IncidentCause = { entryId: string; kind: 'collision' | 'retirement' | 'damage' | 'timeLoss'; carIds: CarId[]; at: SessionTime };

/** One entry of `incidents.feed` (newest first); it updates as its time lost resolves. */
export type IncidentEntry = {
  /** Stable across updates: kind + cars + session time; a penalty entry's id names its penalty record. */
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
  /** Penalty entries only. */
  penalty?: IncidentPenalty;
  /** Neutralised entries only: the entry that caused it. */
  cause?: IncidentCause;
  /** Neutralised entries only: what neutralised the session, the `neutralised` span's car (SC or VSC), `red` for a suspension. */
  neutralisation?: 'SC' | 'VSC' | 'red';
};
