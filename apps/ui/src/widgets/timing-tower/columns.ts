// The column grid of the timing tower (mockup 2-timing): widths in character cells, priority 1 drops last.
import * as text from './text.ts';

export type TowerColumnKey =
  | 'position' | 'change' | 'car' | 'gap' | 'interval' | 'toUs' | 'last' | 's1' | 's2' | 's3'
  | 'compound' | 'age' | 'stops' | 'penalty' | 'pit';

export type TowerColumn = { key: TowerColumnKey; label: string; widthCols: number; priority: number; align: 'left' | 'right' };

/** The tower's columns in display order; the Table drops them by priority, highest number first. */
export const TOWER_COLUMNS: TowerColumn[] = [
  { key: 'position', label: text.headers.position, widthCols: 2, priority: 1, align: 'right' },
  // 3 cells: the widest mark of a 20-car race, 19 places gained or lost (▲19, ▼19).
  { key: 'change', label: text.headers.change, widthCols: 3, priority: 2, align: 'left' },
  { key: 'car', label: text.headers.car, widthCols: 3, priority: 1, align: 'left' },
  { key: 'gap', label: text.headers.gap, widthCols: 7, priority: 3, align: 'right' },
  { key: 'interval', label: text.headers.interval, widthCols: 6, priority: 2, align: 'right' },
  { key: 'toUs', label: text.headers.toUs, widthCols: 6, priority: 3, align: 'right' },
  { key: 'last', label: text.headers.last, widthCols: 8, priority: 2, align: 'right' },
  { key: 's1', label: text.headers.s1, widthCols: 6, priority: 4, align: 'right' },
  { key: 's2', label: text.headers.s2, widthCols: 6, priority: 4, align: 'right' },
  { key: 's3', label: text.headers.s3, widthCols: 6, priority: 4, align: 'right' },
  { key: 'compound', label: text.headers.compound, widthCols: 1, priority: 5, align: 'left' },
  { key: 'age', label: text.headers.age, widthCols: 3, priority: 5, align: 'right' },
  { key: 'stops', label: text.headers.stops, widthCols: 2, priority: 6, align: 'right' },
  { key: 'penalty', label: text.headers.penalty, widthCols: 3, priority: 6, align: 'right' },
  { key: 'pit', label: text.headers.pit, widthCols: 3, priority: 6, align: 'left' },
];
