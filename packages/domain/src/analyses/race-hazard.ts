// Value type of the `race-hazard` calculator (SP4.3b spec §5.2): the remaining race's chances of an SC or a VSC from
// the track file's hazard, scaled by the lobby's SC setting, and the remaining laps of one that is out.
import type { Known } from '../known.ts';

/**
 * `byLap`: per remaining lap the chance an SC and a VSC starts on it, lobby-scaled; `durationLaps`: the chance of one
 * lasting 1, 2, 3 … laps (index 0 = 1 lap); `active`: the neutralisation out now with the pmf of its laps left (index
 * 0 = it ends this lap), else `null`; `lobbyFactor`: the lobby setting's factor on every start chance.
 */
export type RaceHazard = Known<{
  byLap: { lap: number; sc: number; vsc: number }[];
  durationLaps: { sc: number[]; vsc: number[] };
  active: { condition: 'sc' | 'vsc'; remainingLaps: number[] } | null;
  lobbyFactor: number;
}>;
