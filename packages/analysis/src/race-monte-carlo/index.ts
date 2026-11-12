// `race-monte-carlo` (SP4.3b spec §7): a simulator (C50): candidate policies of our cars scored over common random
// scenarios (neutralisations, pace, scatter, rivals' stops and reactions), searched adaptively under a cap of
// scenario-policies (a count, never a clock, C2). Draws only from the injected generator; no reads, no cadence, no topic.
import { defineSimulator } from '@pitwall/engine/readers';

export type * from './types.ts';
export { fieldPositions } from './field.ts';
export { paired, ties } from './rank.ts';
export { hasStopAhead, rivalNextCompound } from './rivals.ts';
export { raceMonteCarlo, scoreAll } from './search.ts';

export const SIMULATOR = defineSimulator('race-monte-carlo');
