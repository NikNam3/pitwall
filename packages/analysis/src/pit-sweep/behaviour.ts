// What `pit-sweep` does per situation (contract C14, C43, C44; SP4.3b spec §9.2): one row per kind of every sub-machine its
// job reads, its own and those of `strategy`'s input (`car-status` included). The machine decided the situation; the job
// only looks up the rows of the spans open now, per our car (`prepare.ts`).
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * `sweep`: the car's tables are computed (a row that changes nothing); `notApplicable`: no sweep for the car (C14:
 * outside the race phase; the race stopped or over; the car in the pit lane, on its in-lap, no longer competing or done
 * with its race). Unlike `undercut`, a neutralisation sweeps: a stop lap under it costs that condition's loss through
 * the DP.
 */
export type PitSweepEffect = 'sweep' | 'notApplicable';

export const PIT_SWEEP_BEHAVIOUR: BehaviourTable<PitSweepEffect> = {
  'weekend-phase': { practice: 'notApplicable', qualifying: 'notApplicable', race: 'sweep', none: 'notApplicable' },
  'session-phase-race': {
    grid: 'sweep',
    formation: 'sweep',
    startLights: 'sweep',
    racing: 'sweep',
    neutralised: 'sweep',
    suspended: 'notApplicable',
    finished: 'notApplicable',
    postSession: 'notApplicable',
  },
  'car-status': { competing: 'sweep', retired: 'notApplicable', disqualified: 'notApplicable', absent: 'notApplicable' },
  'car-activity-race': {
    racingLap: 'sweep',
    inLap: 'notApplicable',
    boxStop: 'notApplicable',
    servingPenalty: 'sweep',
    outLap: 'sweep',
    finished: 'notApplicable',
    coolDown: 'notApplicable',
    notCompeting: 'notApplicable',
  },
  // the driver changes the stop's length (the starting point's `human`), never whether the car is swept
  'car-driver': { ai: 'sweep', human: 'sweep' },
  // the rule is the DP's (`owesStop`, C43): it decides which rows can be made, never whether the car is swept
  'compound-rule': { required: 'sweep', waived: 'sweep' },
};
