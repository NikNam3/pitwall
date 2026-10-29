import type { SectorStatus } from '@pitwall/domain';
import type { Role } from '../theme/roles.ts';

/** Sector colour (rule B2): the session best is purple for every car, a personal best is green for our cars only. */
export function sectorStatusRole(status: SectorStatus, focus: { ours: boolean }): Role | undefined {
  switch (status) {
    case 'sessionBest':
      return 'best';
    case 'personalBest':
      return focus.ours ? 'personalBest' : undefined;
    case 'none':
      return undefined;
  }
}

/** Our cars take the own-car role; others stay neutral. */
export function ourCarRole(ours: boolean): Role | undefined {
  return ours ? 'ownCar' : undefined;
}
