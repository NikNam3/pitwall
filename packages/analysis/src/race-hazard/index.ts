// `race-hazard` (SP4.3b spec §5.2): the remaining race's chances of an SC or a VSC per lap from the track file, scaled
// by the lobby's SC setting, their durations, and the remaining laps of one that is out. A quick calculator: no topic.
import type { RaceHazard } from '@pitwall/domain';

export * from './config.ts';
export { RACE_HAZARD_BEHAVIOUR, type RaceHazardEffect } from './behaviour.ts';
export { raceHazardAsOf } from './asof.ts';
export { raceHazardCalculator } from './calculator.ts';
export { RACE_HAZARD } from './id.ts';

/** The output: the hazard tables. */
export type RaceHazardOutput = RaceHazard;
