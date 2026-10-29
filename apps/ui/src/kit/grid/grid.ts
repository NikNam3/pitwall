// Character-cell grids (brainstorm "column grids"): fixed column widths, numbers right-aligned in fixed decimals.
// `fixed` lives in kit/values/format.ts (the only place numbers become text) and is re-exported here.
export type GridColumn = { width: number; align?: 'left' | 'right' };

/** Text in exactly `width` characters: padded, or cut to `width - 1` plus `…`. */
export function fitCell(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (width <= 0) return '';
  if (text.length > width) return `${text.slice(0, width - 1)}…`;
  return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

/** Width of a grid row in characters. */
export const gridWidth = (columns: readonly GridColumn[], gap = 1): number =>
  columns.reduce((sum, c) => sum + c.width, 0) + Math.max(0, columns.length - 1) * gap;

/** One row: the cells fitted to their columns and joined by `gap` spaces; missing cells are blank. */
export const gridRow = (columns: readonly GridColumn[], cells: readonly string[], gap = 1): string =>
  columns.map((c, i) => fitCell(cells[i] ?? '', c.width, c.align)).join(' '.repeat(gap));

export { fixed } from '../values/format.ts';
