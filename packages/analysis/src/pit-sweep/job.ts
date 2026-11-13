// `pit-sweep`'s job module (SP4.3b spec §9.2): `run` runs in a worker (C51). Contract-first stub (C81) until SP4.3b2 Task 8.
import type { CarId, PitSweepCar } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import type { StrategyInput } from '../strategy/prepare.ts';

/** The job's input: `strategy`'s input and, from Task 8, the call's own reads. */
export type PitSweepInput = { strategy: StrategyInput };

/** The output: per our car its sweep of every compound with a new set; a rival is absent. */
export type PitSweepOutput = Record<CarId, PitSweepCar>;

/** The job's input from the view. Stub until Task 8. */
export function preparePitSweep(): PitSweepInput {
  throw new Error('not implemented');
}

/** Per our car one table per compound (runs in a worker). Stub until Task 8. */
export function run(_input: PitSweepInput, _rng: Rng): PitSweepOutput {
  throw new Error('not implemented');
}
