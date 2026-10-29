import type { DamageJump } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

/** Critical for the newest jump while its lap-time loss is still being measured; no role otherwise. */
export function jumpRole(jump: DamageJump, newest: boolean): Role | undefined {
  const loss = jump.lossMsPerLap;
  return newest && !loss.known && loss.reason === 'insufficientData' ? 'critical' : undefined;
}
