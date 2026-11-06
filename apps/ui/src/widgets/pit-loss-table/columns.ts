// The pit-loss table's columns (mockup docs/design/2026-11-06-sp4.1a/source-badge.html; priorities
// `COND, LOSS > SOURCE > N > STAT`): a lower priority number survives longer when the panel narrows.

export type ConditionColumnKey = 'cond' | 'loss' | 'stat' | 'n' | 'source';
export type StopColumnKey = 'lap' | 'drv' | 'cond' | 'loss' | 'stat';

type Column<K extends string> = { key: K; widthCols: number; align: 'left' | 'right'; priority: number };

/** The condition table; SOURCE is 11 cells wide for `calibration`. */
export const CONDITION_COLUMNS: Array<Column<ConditionColumnKey>> = [
  { key: 'cond', widthCols: 5, align: 'left', priority: 1 },
  { key: 'loss', widthCols: 5, align: 'right', priority: 1 },
  { key: 'stat', widthCols: 4, align: 'right', priority: 4 },
  { key: 'n', widthCols: 2, align: 'right', priority: 3 },
  { key: 'source', widthCols: 11, align: 'left', priority: 2 },
];

/** The stop table (full only). */
export const STOP_COLUMNS: Array<Column<StopColumnKey>> = [
  { key: 'lap', widthCols: 3, align: 'left', priority: 1 },
  { key: 'drv', widthCols: 3, align: 'left', priority: 1 },
  { key: 'cond', widthCols: 5, align: 'left', priority: 2 },
  { key: 'loss', widthCols: 5, align: 'right', priority: 1 },
  { key: 'stat', widthCols: 4, align: 'right', priority: 3 },
];
