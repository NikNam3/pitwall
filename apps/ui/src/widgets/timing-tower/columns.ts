// The column grid of the timing tower (mockup 2-timing): widths in character cells, priority 1 drops last.
export type TowerColumnKey =
  | 'position' | 'change' | 'car' | 'gap' | 'interval' | 'toUs' | 'last' | 's1' | 's2' | 's3'
  | 'compound' | 'age' | 'stops' | 'penalty' | 'pit';

export type TowerColumn = { key: TowerColumnKey; label: string; widthCols: number; priority: number; align: 'left' | 'right' };

/** The tower's columns in display order; the Table drops them by priority, highest number first. */
export const TOWER_COLUMNS: TowerColumn[] = [
  { key: 'position', label: 'P', widthCols: 2, priority: 1, align: 'right' },
  { key: 'change', label: '', widthCols: 2, priority: 2, align: 'left' },
  { key: 'car', label: 'DRV', widthCols: 3, priority: 1, align: 'left' },
  { key: 'gap', label: 'GAP', widthCols: 7, priority: 3, align: 'right' },
  { key: 'interval', label: 'INT', widthCols: 6, priority: 2, align: 'right' },
  { key: 'toUs', label: 'TO US', widthCols: 6, priority: 3, align: 'right' },
  { key: 'last', label: 'LAST', widthCols: 8, priority: 2, align: 'right' },
  { key: 's1', label: 'S1', widthCols: 6, priority: 4, align: 'right' },
  { key: 's2', label: 'S2', widthCols: 6, priority: 4, align: 'right' },
  { key: 's3', label: 'S3', widthCols: 6, priority: 4, align: 'right' },
  { key: 'compound', label: 'T', widthCols: 1, priority: 5, align: 'left' },
  { key: 'age', label: 'AGE', widthCols: 3, priority: 5, align: 'right' },
  { key: 'stops', label: 'ST', widthCols: 2, priority: 6, align: 'right' },
  { key: 'penalty', label: 'PEN', widthCols: 3, priority: 6, align: 'right' },
  { key: 'pit', label: 'PIT', widthCols: 3, priority: 6, align: 'left' },
];
