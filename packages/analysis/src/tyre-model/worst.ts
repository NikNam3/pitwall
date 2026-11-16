import { known, type Known, type TyreModelCompound } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/**
 * A compound's wear rate at its worst corner (SP4.3c ruling R64, C43): the highest of the four, known at the newest
 * `at` of the four; where any corner is unknown, the first unknown one's value (FL, FR, RL, RR), its reason kept (C3).
 */
export function worstWearRate(terms: DeepReadonly<TyreModelCompound>): Known<number> {
  let max = -Infinity;
  let at = -Infinity;
  for (const corner of CORNERS) {
    const v = terms.wearRatePct[corner].value;
    if (!v.known) return v;
    max = Math.max(max, v.value);
    at = Math.max(at, v.at);
  }
  return known(max, at);
}
