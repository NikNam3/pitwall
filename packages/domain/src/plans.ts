// The plan decisions (C76, SP4.3b spec §8.2): the car's newest `planCommitted` or `planCleared` in the projection's
// decisions decides its plan; readers get it here, never by their own matching (C25).
import type { Policy } from './forecast.ts';
import type { CarId } from './ids.ts';
import type { DecisionRecord } from './records.ts';

/** The car's committed plan: its newest plan decision's policy, `null` when cleared or never committed. */
export function latestPlan(_history: { readonly decisions: readonly DecisionRecord[] }, _carId: CarId): Policy | null {
  throw new Error('not implemented');
}
