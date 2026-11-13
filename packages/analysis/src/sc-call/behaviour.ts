// What `sc-call` does per situation (contract C14, C43, C44; SP4.3b spec §9.3, SP4.2 spec 3.3): one row per kind of
// every sub-machine its job reads, its own and those of `strategy`'s input (`car-status` included). The machine decided
// the situation; the job only looks up the rows of the spans open now. Contract-first (C81): the 4.2 `weekend-phase`
// rows are kept; every other row is `notApplicable` until SP4.3b2 Task 9 fills the table.
import type { WeekendPhase } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations say about an SC call. */
export type ScCallEffect = {
  /** The weekend phase is the race: the rows are computed. */
  race?: boolean;
  /** The weekend phase is not the race (C14), or a row Task 9 has not filled yet: both rows `notApplicable`. */
  notApplicable?: boolean;
};

const RACE: ScCallEffect = { race: true };
const NOT_RACE: ScCallEffect = { notApplicable: true };
/** A row Task 9 fills. */
const PENDING: ScCallEffect = { notApplicable: true };

export const SC_CALL_BEHAVIOUR: BehaviourTable<ScCallEffect> = {
  'weekend-phase': { practice: NOT_RACE, qualifying: NOT_RACE, race: RACE, none: NOT_RACE },
  'session-phase-race': {
    grid: PENDING,
    formation: PENDING,
    startLights: PENDING,
    racing: PENDING,
    neutralised: PENDING,
    suspended: PENDING,
    finished: PENDING,
    postSession: PENDING,
  },
  'car-status': { competing: PENDING, retired: PENDING, disqualified: PENDING, absent: PENDING },
  'car-activity-race': {
    racingLap: PENDING,
    inLap: PENDING,
    boxStop: PENDING,
    servingPenalty: PENDING,
    outLap: PENDING,
    finished: PENDING,
    coolDown: PENDING,
    notCompeting: PENDING,
  },
  'car-driver': { ai: PENDING, human: PENDING },
  'compound-rule': { required: PENDING, waived: PENDING },
};

/** The weekend-phase row of `phase`: a pending phase has no span yet and reads as the race (C14). */
export const phaseRow = (phase: WeekendPhase['kind']): ScCallEffect =>
  (phase === 'pending' ? undefined : SC_CALL_BEHAVIOUR['weekend-phase']?.[phase]) ?? RACE;
