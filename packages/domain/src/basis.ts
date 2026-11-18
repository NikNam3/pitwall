// The basis (C62) and the saved plans (C62d), SP4.3e spec §4.2–4.3: the stored sessions a session or a planning round
// builds on, named by session uid and weekend id (a decision names them, never their data, C76), the race assumptions a
// planning round is computed for, and a team's saved plan. JSON-safe. A leaf beside `records.ts`, which names a basis in
// its `basisChosen` decision.
import type { Policy } from './forecast.ts';
import type { SessionUid, TeamId, TrackId } from './ids.ts';
import type { Slot } from './plan-slots.ts';
import type { ForecastSample } from './session.ts';

/** A stored session as a basis names it: its session uid and weekend id; the feed's seat picks its player car (C62). */
export type SessionRef = { sessionUid: SessionUid; weekendId: string };

/** A basis per kind: the practice sessions (`[]`: none) and at most one qualifying or sprint shootout (`null`: none). */
export type SessionBasis = { practice: SessionRef[]; qualifying: SessionRef | null };

/** The basis of no session. */
export const NO_BASIS: SessionBasis = { practice: [], qualifying: null };

const refKey = (ref: SessionRef): string => `${ref.sessionUid}@${ref.weekendId}`;

/** One string per basis: its practice refs sorted by session uid, then its qualifying; equal for equal bases in any order. */
export const basisKey = (basis: SessionBasis): string => {
  const practice = [...basis.practice].sort((a, b) => (a.sessionUid < b.sessionUid ? -1 : a.sessionUid > b.sessionUid ? 1 : 0)).map(refKey);
  return `practice:${practice.join(',')};qualifying:${basis.qualifying === null ? '' : refKey(basis.qualifying)}`;
};

/** The basis sidecar next to a recording (C62): the sessions the session started with and, for display only, the preselection. */
/**
 * The basis sidecar (C59, C62): `start`, `preselected` (display only), and `plans`, each plan choice that reached the
 * feed by record index and the frame its decisions describe (SP4.3e R20, R22; a replay shows the same plan at the same
 * record, C38; after a flashback the newest entry at or before its target, C27a).
 */
export type BasisSidecar = {
  start: SessionBasis;
  preselected: SessionBasis;
  plans?: { at: number; frame: number; plan: { id: string; name: string; laps: number } | null }[];
};

/** The race's forecast a round computes with (C62d): the qualifying's race samples as imported, or the user's rows. */
/**
 * One forecast row the user entered: the time after the race start, the weather and the rain chance. The temperatures
 * are no planning input and not entered: the bridge takes them from the nearest imported row, else the qualifying's own
 * at its end (never a made-up value, C3).
 */
export type EnteredSample = Pick<ForecastSample, 'offsetMs' | 'weather' | 'rainPct'>;
export type RaceConditions = { kind: 'imported' } | { kind: 'entered'; samples: EnteredSample[] };

/** The imported race conditions. */
export const IMPORTED: RaceConditions = { kind: 'imported' };

/**
 * A round's race assumptions: `laps` is `null` while the bridge has no suggestion and none was entered (C3: never a
 * made-up number); the round runs no planning job until it is known.
 */
export type RoundRace = { laps: number | null; sets: RaceAssumptions['sets']; conditions: RaceConditions };

/** A planning round's race assumptions (C62d): the race laps, whether its tyre sets carry over from the qualifying, and its forecast. */
export type RaceAssumptions = { laps: number; sets: 'carried' | 'fresh'; conditions: RaceConditions };

/** One car's prepared plans of the planning round (SP4.3d spec §7.4): by race number, its slots and its active slot. */
export type PreparedCar = { raceNumber: number; slots: Partial<Record<Slot, Policy>>; active: Slot | null };

/**
 * A team's saved plan (C62d): its slot choices per car, tied to no session; `computedOn` notes the basis and the race
 * assumptions it was computed on, for display only. `savedAt` is an ISO time.
 */
export type SavedPlan = {
  id: string;
  name: string;
  team: TeamId;
  trackId: TrackId;
  savedAt: string;
  /** `forecast`: the samples the plan was computed with (`[]` when unknown); `profiles`: the snapshot's fingerprint, `null` without one. */
  computedOn: { basis: SessionBasis; race: RaceAssumptions; forecast: ForecastSample[]; profiles: string | null };
  cars: PreparedCar[];
};
