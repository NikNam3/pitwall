// `strategy-dp` (SP4.3b spec §6): a simulator (C50): one car's stops and compounds to the flag by dynamic programming,
// expected over the SC/VSC chances of each lap, with the trigger thresholds. Pure, no randomness; no reads, no
// cadence, no topic.
import { defineSimulator } from '@pitwall/engine/readers';
import type { DpInput, DpResult } from './types.ts';

export type * from './types.ts';

export const SIMULATOR = defineSimulator('strategy-dp');

/** The car's best plans, its box-now and stay-out variants and its trigger thresholds from `input.fromLap`. */
export function strategyDp(_input: DpInput): DpResult {
  throw new Error('not implemented');
}
