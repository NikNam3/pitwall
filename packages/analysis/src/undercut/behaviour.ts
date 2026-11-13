// What `undercut` does per situation (contract C14, C43, C44; SP4.3b spec §9.1): one row per kind of every sub-machine its
// job reads, its own and those of `strategy`'s input (`car-status` included). The machine decided the situation; the job
// only looks up the rows of the spans open now, per our car (`prepare.ts`).
import type { BehaviourTable } from '../shared/behaviour.ts';

/** `compute`: the car's cases are scored (a row that changes nothing); `notApplicable`: no call for the car. */
export type UndercutEffect = 'compute' | 'notApplicable';

export const UNDERCUT_BEHAVIOUR: BehaviourTable<UndercutEffect> = {
  // a call of the race only (C14)
  'weekend-phase': { practice: 'notApplicable', qualifying: 'notApplicable', race: 'compute', none: 'notApplicable' },
  'session-phase-race': {
    grid: 'compute',
    formation: 'compute',
    startLights: 'compute',
    racing: 'compute',
    // under an SC or VSC the stop is `sc-call`'s
    neutralised: 'notApplicable',
    suspended: 'notApplicable',
    finished: 'notApplicable',
    postSession: 'notApplicable',
  },
  'car-status': { competing: 'compute', retired: 'notApplicable', disqualified: 'notApplicable', absent: 'notApplicable' },
  'car-activity-race': {
    racingLap: 'compute',
    // our car already boxing: no box-now to weigh
    inLap: 'notApplicable',
    boxStop: 'notApplicable',
    servingPenalty: 'compute',
    outLap: 'compute',
    // done with its race: no stop left to call
    finished: 'notApplicable',
    coolDown: 'notApplicable',
    notCompeting: 'notApplicable',
  },
  // the driver changes the stop's length (the starting point's `human`), never a case
  'car-driver': { ai: 'compute', human: 'compute' },
  // the rule is the DP's (`owesStop`) and the rivals' next compound (`rivalNextCompound`, C43), never a case
  'compound-rule': { required: 'compute', waived: 'compute' },
};
