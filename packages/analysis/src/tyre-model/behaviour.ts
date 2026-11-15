// What `tyre-model` does per situation (contract C43, C44): one row per kind of every sub-machine it reads. The machine
// decided whether a car is in the session and who drives it; the unit only looks up the rows of the spans open for a
// car. Which laps of a stint count comes from the lap records (in and out laps, `lap-classes`), so a car's race
// activity and the weekend phase change no term: their rows say so.
import { RACE_LAP_PHASE_ROWS } from '../lap-classes/index.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';
import { IN_SESSION_ROWS } from '../shared/car-status.ts';

/** What the situations open for a car say about its tyre model. */
export type TyreModelEffect = {
  /** The car is in the session and has an entry; set by car-status, so a slot without its span has none (C17). */
  inSession?: boolean;
  /** A human drives the car: its prior's k is the profile's or the human default, and the game simulates its temperatures (the heat term, research 20 §1). */
  human?: boolean;
  /** The weekend phase is the race (no term differs by it: a rate has no lap-1 rule). */
  isRace?: boolean;
};

/** A car's race activity changes no tyre term. */
const SAME: TyreModelEffect = {};

export const TYRE_MODEL_BEHAVIOUR: BehaviourTable<TyreModelEffect> = {
  'car-status': IN_SESSION_ROWS,
  'car-driver': { ai: { human: false }, human: { human: true } },
  'car-activity-race': { racingLap: SAME, inLap: SAME, boxStop: SAME, servingPenalty: SAME, outLap: SAME, finished: SAME, coolDown: SAME, notCompeting: SAME },
  'weekend-phase': RACE_LAP_PHASE_ROWS,
};
