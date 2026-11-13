// `scoreCalls` (SP4.3b2 Task 4): a call's cases scored on common scenarios. Contract-first stub (C81).
import type { Rng } from '@pitwall/engine/readers';
import type { CallInput, CallResult } from './types.ts';

/**
 * Every candidate on the same `input.scenarios` scenarios (common random numbers, no search, nothing dropped), each to
 * its `untilLap`; a candidate's `rival` replaces that rival's drawn stops in that candidate only.
 */
export function scoreCalls(_input: CallInput, _rng: Rng): CallResult {
  throw new Error('not implemented');
}
