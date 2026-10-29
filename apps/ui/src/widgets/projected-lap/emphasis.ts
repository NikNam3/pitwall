import { sectorStatusRole } from '../../emphasis/index.ts';
import type { Role } from '../../theme/roles.ts';

/** Critical when the projection is outside the cut-off (margin below zero). */
export const cutOffRole = (marginMs: number): Role | undefined => (marginMs < 0 ? 'critical' : undefined);

/** Critical when no further lap can start before the clock runs out (margin below zero). */
export const finishRole = (marginMs: number): Role | undefined => (marginMs < 0 ? 'critical' : undefined);

/** The personal-best role for a projection faster than the car's best lap; green only for our cars (rule B2). */
export const deltaRole = (deltaToBestMs: number, ours: boolean): Role | undefined =>
  deltaToBestMs < 0 ? sectorStatusRole('personalBest', { ours }) : undefined;
