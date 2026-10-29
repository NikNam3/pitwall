import type { BestStatus } from '@pitwall/domain';
import { sectorStatusRole } from '../../emphasis/index.ts';
import type { Role } from '../../theme/roles.ts';

/**
 * Colour of a time cell: purple for a session best, for every car. No green: every value of this best-lap table is a
 * personal best, so green would carry nothing (user rule: colour only to highlight).
 */
export function cellRole(status: BestStatus): Role | undefined {
  return sectorStatusRole(status, { ours: false });
}
