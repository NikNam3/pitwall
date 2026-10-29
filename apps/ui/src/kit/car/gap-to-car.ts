import type { GapToCar, UnknownReason } from '@pitwall/domain';
import { formatGap, formatLapsDown } from '../values/format.ts';

/**
 * The text of a gap to a car (`gaps.toCar`, positive = behind it): the laps between the cars when lapped (`+1 lap`,
 * `−2 laps`), else the signed time; an unknown gap is empty with the reason for the hover.
 */
export function gapToCarCell(gap: Pick<GapToCar, 'gapMs' | 'lapsDown'>): { text: string; reason?: UnknownReason } {
  if (gap.lapsDown !== 0) return { text: formatLapsDown(gap.lapsDown) };
  return gap.gapMs.known ? { text: formatGap(gap.gapMs.value) } : { text: '', reason: gap.gapMs.reason };
}
