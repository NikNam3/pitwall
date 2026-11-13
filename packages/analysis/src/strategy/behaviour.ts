// What `strategy` does per situation (contract C14, C43, C44; SP4.3b spec §8.1): one row per kind of every sub-machine
// its job reads, its own and those its starting point's units read (`car-status`). The machine decided the situation;
// the job only looks up the rows of the spans open now, per our car.
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * `plan`: the car is planned (a row that changes nothing); `notApplicable`: no plan for the car (C14: outside the
 * race phase; the race stopped or over; the car no longer competing or done with its race).
 */
export type StrategyEffect = 'plan' | 'notApplicable';

export const STRATEGY_BEHAVIOUR: BehaviourTable<StrategyEffect> = {
  'weekend-phase': { practice: 'notApplicable', qualifying: 'notApplicable', race: 'plan', none: 'notApplicable' },
  'session-phase-race': {
    grid: 'plan',
    formation: 'plan',
    startLights: 'plan',
    racing: 'plan',
    neutralised: 'plan',
    suspended: 'notApplicable',
    finished: 'notApplicable',
    postSession: 'notApplicable',
  },
  'car-status': { competing: 'plan', retired: 'notApplicable', disqualified: 'notApplicable', absent: 'notApplicable' },
  'car-activity-race': {
    racingLap: 'plan',
    inLap: 'plan',
    boxStop: 'plan',
    servingPenalty: 'plan',
    outLap: 'plan',
    finished: 'notApplicable',
    coolDown: 'notApplicable',
    notCompeting: 'notApplicable',
  },
  // the driver changes the stop's length (the starting point's `human`), never whether the car is planned
  'car-driver': { ai: 'plan', human: 'plan' },
  // the rule is the DP's (`owesStop`, rival-stops' judgement, C43), never whether the car is planned
  'compound-rule': { required: 'plan', waived: 'plan' },
};
