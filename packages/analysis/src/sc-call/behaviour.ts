// What `sc-call` does per situation (contract C14, C43, C44; SP4.3b spec §9.3, SP4.2 spec 3.3): one row per kind of
// every sub-machine its job reads, its own and those of `strategy`'s input (`car-status` included). The machine decided
// the situation; `prepare` only looks up the rows of the spans open now, per our car. The 4.2 `weekend-phase` rows are
// kept.
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * `call`: the call is computed, green: SC and VSC each forced from now (a row that changes nothing);
 * `realCondition`: a neutralisation is out: one run on it as it is, the other condition's row `notApplicable`;
 * `notApplicable`: both rows `notApplicable` (C14: outside the race phase; the race stopped or over; the car in the pit
 * lane, no longer competing or done with its race). `notApplicable` wins over `realCondition`, which wins over `call`.
 */
export type ScCallEffect = 'call' | 'realCondition' | 'notApplicable';

export const SC_CALL_BEHAVIOUR: BehaviourTable<ScCallEffect> = {
  'weekend-phase': { practice: 'notApplicable', qualifying: 'notApplicable', race: 'call', none: 'notApplicable' },
  'session-phase-race': {
    grid: 'call',
    formation: 'call',
    startLights: 'call',
    racing: 'call',
    neutralised: 'realCondition',
    suspended: 'notApplicable',
    finished: 'notApplicable',
    postSession: 'notApplicable',
  },
  'car-status': { competing: 'call', retired: 'notApplicable', disqualified: 'notApplicable', absent: 'notApplicable' },
  'car-activity-race': {
    racingLap: 'call',
    inLap: 'call',
    // in the pit lane: no box-or-stay-out choice left (spec §9.3)
    boxStop: 'notApplicable',
    servingPenalty: 'notApplicable',
    outLap: 'call',
    finished: 'notApplicable',
    coolDown: 'notApplicable',
    notCompeting: 'notApplicable',
  },
  // the driver changes the stop's length (the starting point's `human`), never the call
  'car-driver': { ai: 'call', human: 'call' },
  // the rule is the DP's (`owesSecondCompound`), never whether the call is made
  'compound-rule': { required: 'call', waived: 'call' },
};

/** The rows of one car combined: `notApplicable` over `realCondition` over `call`. */
export function effectOf(rows: readonly ScCallEffect[]): ScCallEffect {
  if (rows.includes('notApplicable')) return 'notApplicable';
  return rows.includes('realCondition') ? 'realCondition' : 'call';
}
