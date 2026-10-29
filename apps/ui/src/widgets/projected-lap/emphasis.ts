import { sectorStatusRole } from '../../emphasis/index.ts';
import type { Role } from '../../theme/roles.ts';

/** Critical when the projection is outside the cut-off (margin below zero). */
export const cutOffRole = (marginMs: number): Role | undefined => (marginMs < 0 ? 'critical' : undefined);

/** Critical when no further lap can start before the clock runs out (margin below zero). */
export const finishRole = (marginMs: number): Role | undefined => (marginMs < 0 ? 'critical' : undefined);

/** The personal-best role for a projection faster than our best lap. */
export const deltaRole = (deltaToBestMs: number): Role | undefined =>
  deltaToBestMs < 0 ? sectorStatusRole('personalBest', { ours: true }) : undefined;
