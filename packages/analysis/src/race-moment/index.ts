// `race-moment` (spec 7): publishes `raceMoment.current`.
import type { Known, RaceMoment } from '@pitwall/domain';

export type { Moment, RaceMoment } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const RACE_MOMENT = 'race-moment';

/** The output: the topic's value; `notApplicable` outside the race. */
export type RaceMomentOutput = Known<RaceMoment>;
