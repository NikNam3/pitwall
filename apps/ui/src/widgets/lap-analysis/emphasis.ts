import type { SectorStatus } from '@pitwall/domain';
import { sectorStatusRole } from '../../emphasis/index.ts';
import type { Role } from '../../theme/roles.ts';

/** Colour of a time cell (rule B2): purple for a session best, green for a personal best of our cars only. */
export function cellRole(status: SectorStatus, ours: boolean): Role | undefined {
  return sectorStatusRole(status, { ours });
}
