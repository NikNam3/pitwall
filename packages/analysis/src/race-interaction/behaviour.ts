// What `race-interaction` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads.
// The weekend phase decides whether the session has race interaction at all; the session phase and a car's status
// decide, by a lap's membership (C26), whether the lap may hold a following episode (spec 5.5's filter).
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What a situation says about the race's interaction parameters. */
export type RaceInteractionEffect = {
  /** The weekend phase has no race interaction: the session's values are `notApplicable` (C14). */
  notApplicable?: boolean;
  /** A lap that belongs to this span holds no following episode (formation, neutralised, a car that does not compete). */
  excludesLap?: boolean;
};

const NONE: RaceInteractionEffect = {};
const NOT_APPLICABLE: RaceInteractionEffect = { notApplicable: true };
const EXCLUDES: RaceInteractionEffect = { excludesLap: true };

export const RACE_INTERACTION_BEHAVIOUR: BehaviourTable<RaceInteractionEffect> = {
  'weekend-phase': { practice: NOT_APPLICABLE, qualifying: NOT_APPLICABLE, race: NONE, none: NOT_APPLICABLE },
  'session-phase-race': {
    grid: EXCLUDES,
    formation: EXCLUDES,
    startLights: EXCLUDES,
    racing: NONE,
    neutralised: EXCLUDES,
    suspended: EXCLUDES,
    finished: NONE,
    postSession: EXCLUDES,
  },
  'car-status': { competing: NONE, retired: EXCLUDES, disqualified: EXCLUDES, absent: EXCLUDES },
};
