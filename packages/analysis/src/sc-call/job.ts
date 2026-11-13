// `sc-call`'s job module (SP4.3b spec §9.3): `run` runs in a worker (C51). Contract-first stub (C81) until SP4.3b2 Task 9.
import type { CarId, ScCall } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import type { StrategyInput } from '../strategy/prepare.ts';

/** The job's input: `strategy`'s input and, from Task 9, the call's own reads. */
export type ScCallInput = { strategy: StrategyInput };

/** The output: per our car its `scCall.car` value (both rows `unknown(reason)` where the call does not apply); a rival is absent. */
export type ScCallOutput = Record<CarId, ScCall>;

/** The job's input from the view. Stub until Task 9. */
export function prepareScCall(): ScCallInput {
  throw new Error('not implemented');
}

/** Per our car the SC and VSC rows (runs in a worker). Stub until Task 9. */
export function run(_input: ScCallInput, _rng: Rng): ScCallOutput {
  throw new Error('not implemented');
}
