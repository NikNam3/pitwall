// What `weekend-pace` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the situation; the calculator only looks up the session's and a car's rows.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** Which sessions' laps give a car's pace. */
export type WeekendPaceSessions = 'notApplicable' | 'earlier' | 'earlierAndOwn';

/** What an earlier (stored) session of a weekend phase gives a car's pace: its long runs, its qualifying best, nothing. */
export type WeekendPaceAsEarlier = 'longRun' | 'qualifyingBest' | 'none';

/** What the situations open for the session and a car say about its weekend pace. */
export type WeekendPaceEffect = {
  /**
   * The sessions the pace comes from: the weekend's earlier sessions (`earlier`), in qualifying also the session's own
   * laps (`earlierAndOwn`, the planning round's view, C62d); `notApplicable` without a weekend phase (C14).
   */
  sessions?: WeekendPaceSessions;
  /** What a stored earlier session of this weekend phase contributes (C62); set on every `weekend-phase` row. */
  asEarlier?: WeekendPaceAsEarlier;
  /** The car competes and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
};

export const WEEKEND_PACE_BEHAVIOUR: BehaviourTable<WeekendPaceEffect> = {
  'weekend-phase': {
    practice: { sessions: 'earlier', asEarlier: 'longRun' },
    qualifying: { sessions: 'earlierAndOwn', asEarlier: 'qualifyingBest' },
    race: { sessions: 'earlier', asEarlier: 'none' },
    none: { sessions: 'notApplicable', asEarlier: 'none' },
  },
  'car-status': {
    competing: { inSession: true },
    retired: { inSession: false },
    disqualified: { inSession: false },
    absent: { inSession: false },
  },
};

/** The row of a pending weekend phase: no span yet, no pace (C14). */
export const PENDING_ROW: WeekendPaceEffect = { sessions: 'notApplicable', asEarlier: 'none' };
