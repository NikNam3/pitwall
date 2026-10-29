import type { Known, Ms } from '@pitwall/domain';
import { formatDeltaMs, formatLapTime, formatSector } from '../../kit/values/format.ts';
import type { Cell } from './rows.ts';

export type LapColumnKey = 'drv' | 's1' | 's2' | 's3' | 'best' | 'theo';

/** The table's columns in order; a lower priority number survives longer when the panel narrows. */
export const LAP_COLUMNS: Array<{ key: LapColumnKey; widthCols: number; align: 'left' | 'right'; priority: number }> = [
  { key: 'drv', widthCols: 3, align: 'left', priority: 1 },
  { key: 'best', widthCols: 8, align: 'right', priority: 1 },
  { key: 's1', widthCols: 6, align: 'right', priority: 3 },
  { key: 's2', widthCols: 6, align: 'right', priority: 3 },
  { key: 's3', widthCols: 6, align: 'right', priority: 3 },
  { key: 'theo', widthCols: 8, align: 'right', priority: 2 },
];

const isLap = (key: LapColumnKey): boolean => key === 'best' || key === 'theo';

/** The text of a time cell: an absolute lap or sector, or a signed delta; empty when unknown. */
export function formatCell(key: LapColumnKey, cell: Cell): string {
  const value: Known<Ms> = cell.value;
  if (!value.known) return '';
  if (!cell.absolute) return formatDeltaMs(value.value);
  return isLap(key) ? formatLapTime(value.value) : formatSector(value.value);
}
