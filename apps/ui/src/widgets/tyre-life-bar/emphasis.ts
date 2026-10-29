import type { Known } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Critical when the laps to the limit are known and below the alarm threshold (`TyreWear.warnLaps`); nothing otherwise. */
export function lapsToLimitRole(laps: Known<number>, threshold: number): Role | undefined {
  return laps.known && laps.value < threshold ? 'critical' : undefined;
}
