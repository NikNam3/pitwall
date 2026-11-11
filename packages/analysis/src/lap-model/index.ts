// `lap-model` (SP4.3a spec 6.2): a simulator (C50): one car, one lap, additive, on plain inputs only; its parameters
// are built by `forecast-field`. No reads, no cadence, no topic.
import type { LapInput, LapModelParams } from '@pitwall/domain';
import { defineSimulator } from '@pitwall/engine/readers';

export const SIMULATOR = defineSimulator('lap-model');

/** One car's lap time (ms, floating) under `p`. */
export function lapTimeMs(_p: LapModelParams, _car: LapInput): number {
  throw new Error('not implemented');
}
