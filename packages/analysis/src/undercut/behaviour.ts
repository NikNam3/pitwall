// What `undercut` does per situation (contract C14, C43, C44; SP4.3b spec §9): one row per kind of every sub-machine its job
// reads, its own and those of `strategy`'s input (`car-status` included). Contract-first stub (C81): every row
// `notApplicable` until SP4.3b2 Task 7 fills the table.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** `notApplicable`: no call for the car. Task 7 adds the effects that compute. */
export type UndercutEffect = 'notApplicable';

export const UNDERCUT_BEHAVIOUR: BehaviourTable<UndercutEffect> = {
  'weekend-phase': { practice: 'notApplicable', qualifying: 'notApplicable', race: 'notApplicable', none: 'notApplicable' },
  'session-phase-race': {
    grid: 'notApplicable',
    formation: 'notApplicable',
    startLights: 'notApplicable',
    racing: 'notApplicable',
    neutralised: 'notApplicable',
    suspended: 'notApplicable',
    finished: 'notApplicable',
    postSession: 'notApplicable',
  },
  'car-status': { competing: 'notApplicable', retired: 'notApplicable', disqualified: 'notApplicable', absent: 'notApplicable' },
  'car-activity-race': {
    racingLap: 'notApplicable',
    inLap: 'notApplicable',
    boxStop: 'notApplicable',
    servingPenalty: 'notApplicable',
    outLap: 'notApplicable',
    finished: 'notApplicable',
    coolDown: 'notApplicable',
    notCompeting: 'notApplicable',
  },
  'car-driver': { ai: 'notApplicable', human: 'notApplicable' },
  'compound-rule': { required: 'notApplicable', waived: 'notApplicable' },
};
