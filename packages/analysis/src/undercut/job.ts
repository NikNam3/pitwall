// `undercut`'s job module (SP4.3b spec §9.1): `run` runs in a worker (C51). Contract-first stub (C81) until SP4.3b2 Task 7.
import type { CarId, Known, Undercut } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import type { StrategyInput } from '../strategy/prepare.ts';

/** The job's input: `strategy`'s input and, from Task 7, the call's own reads. */
export type UndercutInput = { strategy: StrategyInput };

/** The output: per our car its `undercut.car` value (`unknown(reason)` where the call does not apply); a rival is absent. */
export type UndercutOutput = Record<CarId, Known<Undercut>>;

/** The job's input from the view. Stub until Task 7. */
export function prepareUndercut(): UndercutInput {
  throw new Error('not implemented');
}

/** Per our car the undercut cases (runs in a worker). Stub until Task 7. */
export function run(_input: UndercutInput, _rng: Rng): UndercutOutput {
  throw new Error('not implemented');
}
