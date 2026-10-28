import type { FiaFlag } from '@pitwall/domain';
import type { Role } from '../theme/roles.ts';

/** Purple for the overall best, green for a personal best, neutral otherwise. */
export function sectorEmphasis(sector: {
  timeMs: number;
  personalBestMs?: number;
  overallBestMs?: number;
}): Role | undefined {
  if (sector.overallBestMs !== undefined && sector.timeMs <= sector.overallBestMs) return 'best';
  if (sector.personalBestMs !== undefined && sector.timeMs <= sector.personalBestMs) return 'personalBest';
  return undefined;
}

/** Flags are coloured only when not green; unknown and none are neutral. */
export function flagRole(flag: FiaFlag): Role | undefined {
  switch (flag) {
    case 'yellow':
      return 'flagYellow';
    case 'blue':
      return 'flagBlue';
    default:
      return undefined;
  }
}

/** A condition band is highlighted only when outside its window. */
export function bandRole(band: 'low' | 'in' | 'high'): Role | undefined {
  return band === 'in' ? undefined : 'warning';
}
