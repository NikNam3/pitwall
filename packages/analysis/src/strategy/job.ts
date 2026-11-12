// `strategy`'s job (C51; SP4.3b spec §8.1), run in a worker: the candidates per our car, the two rounds of planning
// against the teammate, then `race-monte-carlo` under the scenario-policy cap. No state between runs (C31, C32).
import type { StrategyOutput } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import type { StrategyInput } from './prepare.ts';

/** Our cars' ranked policies (runs in a worker). */
export function run(_input: StrategyInput, _rng: Rng): StrategyOutput {
  throw new Error('not implemented');
}
