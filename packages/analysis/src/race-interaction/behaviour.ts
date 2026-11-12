// What `race-interaction` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads.
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What a situation says about the race's interaction parameters. */
export type RaceInteractionEffect = Record<string, never>;

/** A stub until SP4.3a Task 12's implement phase writes the rows. */
export const RACE_INTERACTION_BEHAVIOUR: BehaviourTable<RaceInteractionEffect> = {};
