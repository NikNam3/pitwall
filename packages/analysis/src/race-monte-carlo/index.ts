// `race-monte-carlo` (SP4.3b spec §7): a simulator (C50): candidate policies of our cars scored over common random
// scenarios (neutralisations, weather, pace, scatter, rivals' stops and reactions), searched adaptively under a cap of
// scenario-policies (a count, never a clock, C2). Draws only from the injected generator; no reads, no cadence, no topic.
import { defineSimulator, type Rng } from '@pitwall/engine/readers';
import type { FieldInput, FieldResult, McInput, McResult } from './types.ts';

export type * from './types.ts';

export const SIMULATOR = defineSimulator('race-monte-carlo');

/** The candidates ranked by the capped adaptive search (spec §7.3); at most `maxScenarioPolicies` scenario-policies. */
export function raceMonteCarlo(_input: McInput, _rng: Rng, _maxScenarioPolicies: number): McResult {
  throw new Error('not implemented');
}

/** Every candidate on the same `scenarios` scenarios, nothing dropped: the good-selection reference (Task 20b). */
export function scoreAll(_input: McInput, _rng: Rng, _scenarios: number): McResult {
  throw new Error('not implemented');
}

/** Every car's position pmf at each requested lap under fixed plans (`forecast-score`'s CRPS). */
export function fieldPositions(_input: FieldInput, _rng: Rng): FieldResult {
  throw new Error('not implemented');
}
