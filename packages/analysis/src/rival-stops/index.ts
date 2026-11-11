// `rival-stops` (SP4.3a spec 5.3): per rival the next stop's window, the odds of each next compound and whether the
// car still owes a stop. A calculator: no topic.
import type { RivalStops } from '@pitwall/domain';

export * from './config.ts';
export { rivalStopsAsOf } from './asof.ts';

/** The calculator id. */
export const RIVAL_STOPS = 'rival-stops';

/** The output: per car its next stop. */
export type RivalStopsOutput = RivalStops;
