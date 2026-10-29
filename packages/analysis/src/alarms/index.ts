// `alarms` (spec 5.6): raises insights for our cars; they reach the existing `insights` topic, so it has no topic of its own.
import type { Insight } from '@pitwall/domain';

export * from './config.ts';

/** The calculator id. */
export const ALARMS = 'alarms';

/** The output: the active alarms of our cars. */
export type AlarmsOutput = Insight[];
