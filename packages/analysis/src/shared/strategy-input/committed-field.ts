// SP4.3b2 Task 18f: the committed teammates of one car's call, one rule for every job (C43). Stub of the test phase.
import type { CarId, Policy } from '@pitwall/domain';
import type { StrategyInput } from './input.ts';

/**
 * Car `car`'s call's committed field: each other car of ours in the planned field with a commit, its committed policy as
 * far as it can follow it (a passed stop boxes this lap, a stop onto a compound without a set left is dropped).
 */
export function committedField(input: StrategyInput, car: CarId): Record<CarId, Policy | null> {
  void input;
  void car;
  throw new Error('not implemented');
}
