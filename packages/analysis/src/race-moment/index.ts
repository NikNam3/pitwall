// `race-moment` (spec 7): publishes `raceMoment.current`.
import type { Known, RaceMoment } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

export type { Moment, RaceMoment } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const RACE_MOMENT = 'race-moment';

/** The output: the topic's value; `notApplicable` outside the race. */
export type RaceMomentOutput = Known<RaceMoment>;

/** What a span kind means for the moment: whether the weekend phase is the race, whether the session phase is a neutralisation (C46). */
export interface MomentBehaviour {
  readonly applicable?: boolean;
  readonly neutralised?: boolean;
}

const REST: MomentBehaviour = {};

/** One row per kind of each sub-machine the unit reads (C44): race-moment takes situation moments from the machine and detects none itself. */
export const RACE_MOMENT_BEHAVIOUR: BehaviourTable<MomentBehaviour> = {
  'weekend-phase': { practice: {}, qualifying: {}, race: { applicable: true }, none: {} },
  'session-phase-race': {
    grid: REST,
    formation: REST,
    startLights: REST,
    racing: REST,
    neutralised: { neutralised: true },
    suspended: { neutralised: true },
    finished: REST,
    postSession: REST,
  },
};
