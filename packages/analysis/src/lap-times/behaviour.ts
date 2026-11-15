// What `lap-times` does per situation (contract C43, C44): one row per kind of every sub-machine it reads. The machine
// decided the situation; the calculator only looks up the rows of the spans open for a car and merges them.
import { RACE_LAP_PHASE_ROWS, type LapPhaseKind } from '../lap-classes/index.ts';
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
  /** The session is a race: lap 1 is no best (`lap-classes`). */
  isRace?: boolean;
  /** The session is timed: a projection has a finish margin. */
  timed?: true;
  /** The car's current lap is invalid: its live sector times rank as no best (spec 3.4). */
  invalidLap?: true;
};

const OFF: LapTimesEffect = { offLap: true };
const ON: LapTimesEffect = {};

/** The weekend-phase rows: `lap-classes`' (C43; a pending phase reads as the race, `lapPhaseRowOf`), timed outside the race. */
export const LAP_TIMES_PHASE_ROWS = {
  practice: { ...RACE_LAP_PHASE_ROWS.practice, timed: true },
  qualifying: { ...RACE_LAP_PHASE_ROWS.qualifying, timed: true },
  race: RACE_LAP_PHASE_ROWS.race,
  none: { ...RACE_LAP_PHASE_ROWS.none, ...OFF },
} as const satisfies Record<LapPhaseKind, LapTimesEffect>;

export const LAP_TIMES_BEHAVIOUR: BehaviourTable<LapTimesEffect> = {
  'weekend-phase': LAP_TIMES_PHASE_ROWS,
  'car-status': { competing: ON, retired: { outOfRace: true }, disqualified: { outOfRace: true }, absent: { absent: true } },
  'car-location': { garage: OFF, pitLane: OFF, track: ON },
  'car-activity-race': { racingLap: ON, inLap: OFF, boxStop: OFF, servingPenalty: ON, outLap: OFF, finished: OFF, coolDown: OFF, notCompeting: ON },
  'car-activity-qualifying': { outLap: OFF, pushLap: ON, inLap: OFF, garage: OFF, finished: OFF, notCompeting: ON },
  'car-activity-practice': { outLap: OFF, flyingLap: ON, inLap: OFF, garage: OFF, finished: OFF, notCompeting: ON },
  'lap-validity': { valid: ON, invalid: { invalidLap: true } },
};
