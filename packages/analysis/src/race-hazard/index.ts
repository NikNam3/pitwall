// `race-hazard` (SP4.3b spec §5.2): the remaining race's chances of an SC or a VSC per lap from the track file, scaled
// by the lobby's SC setting, their durations, and the remaining laps of one that is out. A quick calculator: no topic.
import type { RaceHazard } from '@pitwall/domain';

export * from './config.ts';
export { raceHazardAsOf } from './asof.ts';

/** The calculator id. */
export const RACE_HAZARD = 'race-hazard';

/** The output: the hazard tables. */
export type RaceHazardOutput = RaceHazard;
