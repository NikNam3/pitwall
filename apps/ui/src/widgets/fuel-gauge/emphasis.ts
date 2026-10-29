import type { Known } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Critical when the fuel does not last to the end (margin below zero); nothing otherwise, also when unknown. */
export function marginRole(marginLaps: Known<number>): Role | undefined {
  return marginLaps.known && marginLaps.value < 0 ? 'critical' : undefined;
}
