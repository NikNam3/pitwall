import type { GapToCar } from '@pitwall/domain';
import { knownPart, type CellPart } from '../grid/grid.ts';
import { formatGap, formatLapsDown } from '../values/format.ts';

/**
 * The text of a gap to a car (`gaps.toCar`, positive = behind it): the laps between the cars when lapped (`+1 lap`,
 * `−2 laps`), else the signed time; an unknown gap is empty with the reason for the hover.
 */
export function gapToCarCell(gap: Pick<GapToCar, 'gapMs' | 'lapsDown'>): CellPart {
  if (gap.lapsDown !== 0) return { text: formatLapsDown(gap.lapsDown) };
  return knownPart(gap.gapMs, formatGap);
}
