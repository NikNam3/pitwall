// What `lap-overview` does per situation (contract C14, C43, C44, spec 3.2): one row per kind of every sub-machine it
// reads. The weekend phase says whether lap 1 is a pace lap (`lap-classes`); a session-phase row says whether a lap whose
// membership holds its span is `red`. Every other status comes from the lap record's neutralised time.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations say about a lap. */
export type LapOverviewEffect = {
  /** The weekend phase is the race: lap 1 is no pace lap (`lap-classes`). */
  isRace?: boolean;
  /** The lap's membership holds a suspension: its status is `red`, over its neutralised time. */
  red?: boolean;
};

const RACE: LapOverviewEffect = { isRace: true };
const NOT_RACE: LapOverviewEffect = { isRace: false };
/** A session phase that leaves the status to the lap's neutralised time. */
const BY_SHARES: LapOverviewEffect = {};
const RED: LapOverviewEffect = { red: true };

export const LAP_OVERVIEW_BEHAVIOUR: BehaviourTable<LapOverviewEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
  'session-phase-race': {
    grid: BY_SHARES,
    formation: BY_SHARES,
    startLights: BY_SHARES,
    racing: BY_SHARES,
    neutralised: BY_SHARES,
    suspended: RED,
    finished: BY_SHARES,
    postSession: BY_SHARES,
  },
  'session-phase-qualifying': { grid: BY_SHARES, running: BY_SHARES, suspended: RED, finished: BY_SHARES, postSession: BY_SHARES },
  'session-phase-practice': { grid: BY_SHARES, running: BY_SHARES, suspended: RED, finished: BY_SHARES, postSession: BY_SHARES },
};

/** The session-phase machines of the table, whose spans in a lap's membership decide `red`. */
export const SESSION_PHASE_MACHINES = ['session-phase-race', 'session-phase-qualifying', 'session-phase-practice'] as const;
