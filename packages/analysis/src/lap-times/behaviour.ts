// What `lap-times` does per situation (contract C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open for a car and merges them.
import type { BehaviourTable } from '../shared/behaviour.ts';

/**
 * What a situation changes in a car's row and projection; every field absent means "no change". The rows of the spans
 * open for a car are merged (C44).
 */
export type LapTimesEffect = {
  /** The car has no lap to project on: no projection (`onLap: false`, all `notApplicable`). */
  offLap?: true;
  /** The car is not in the session: no board row and no projection. */
  absent?: true;
  /** The car is out of the race: its times stay set, no more will come, no projection. */
  outOfRace?: true;
  /** The session is timed: a projection has a finish margin. */
  timed?: true;
};

const OFF: LapTimesEffect = { offLap: true };
const ON: LapTimesEffect = {};

export const LAP_TIMES_BEHAVIOUR: BehaviourTable<LapTimesEffect> = {
  'weekend-phase': { practice: { timed: true }, qualifying: { timed: true }, race: {}, none: OFF },
  'car-status': { competing: ON, retired: { outOfRace: true }, disqualified: { outOfRace: true }, absent: { absent: true } },
  'car-location': { garage: OFF, pitLane: OFF, track: ON },
  'car-activity-race': { racingLap: ON, inLap: OFF, boxStop: OFF, servingPenalty: ON, outLap: OFF, finished: OFF, coolDown: OFF, notCompeting: ON },
  'car-activity-qualifying': { outLap: OFF, pushLap: ON, inLap: OFF, garage: OFF, finished: OFF, notCompeting: ON },
  'car-activity-practice': { outLap: OFF, flyingLap: ON, inLap: OFF, garage: OFF, finished: OFF, notCompeting: ON },
};
