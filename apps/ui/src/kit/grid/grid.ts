// Character-cell grids (brainstorm "column grids"): fixed column widths, numbers right-aligned in fixed decimals.
// `fixed` lives in kit/values/format.ts (the only place numbers become text) and is re-exported here.
import type { UnknownReason } from '@pitwall/domain';
import { unknownMark } from '../text.ts';

export type GridColumn = { width: number; align?: 'left' | 'right' };

/** Text in exactly `width` characters: padded, or cut to `width - 1` plus `…`. */
export function fitCell(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (width <= 0) return '';
  if (text.length > width) return `${text.slice(0, width - 1)}…`;
  return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

/** A piece of a cell that mixes known texts and unknown values: a known text, or an unknown that shows its reason's mark. */
export type CellPart = { text: string; reason?: UnknownReason | undefined };

/** The characters a part takes: its text, or its reason's mark. */
const partWidth = (p: CellPart): number => (p.reason === undefined ? p.text.length : unknownMark[p.reason].length);

/** The longest start of `text` in `room` characters that ends at a word end (with its space): `OCO SAI` in 6 is `OCO `. */
function wordCut(text: string, room: number): string {
  if (text.length <= room) return text;
  if (room <= 0) return '';
  const end = text.lastIndexOf(' ', room - 1);
  return end < 0 ? '' : text.slice(0, end + 1);
}

/**
 * Parts in exactly `width` characters, padded at the end (the padding is a last known part). When they do not fit, every
 * mark keeps its place and the known text gives way from the end of the cell: text after the last mark is cut with `…`
 * (as `fitCell`); text cut before a mark ends at a word end, never in `…`, which would read as one more mark.
 */
export function fitParts(parts: readonly CellPart[], width: number): CellPart[] {
  const total = parts.reduce((sum, p) => sum + partWidth(p), 0);
  if (total <= width) return total === width ? [...parts] : [...parts, { text: ' '.repeat(width - total) }];
  const lastMark = parts.findLastIndex((p) => p.reason !== undefined);
  let room = width - parts.reduce((sum, p) => sum + (p.reason === undefined ? 0 : partWidth(p)), 0);
  const fitted: CellPart[] = [];
  let cut = false;
  for (const [i, p] of parts.entries()) {
    if (p.reason !== undefined) {
      fitted.push(p);
    } else if (i > lastMark) {
      // only known text is left: the rest of the cell is cut as one text
      if (!cut) fitted.push({ text: fitCell(parts.slice(i).map((q) => q.text).join(''), Math.max(0, room)) });
      break;
    } else if (!cut) {
      const kept = p.text.length <= room ? p.text : wordCut(p.text, room);
      cut = kept !== p.text;
      room -= kept.length;
      if (kept !== '') fitted.push({ text: kept });
    }
  }
  const used = fitted.reduce((sum, p) => sum + partWidth(p), 0);
  return used < width ? [...fitted, { text: ' '.repeat(width - used) }] : fitted;
}

/** Width of a grid row in characters. */
export const gridWidth = (columns: readonly GridColumn[], gap = 1): number =>
  columns.reduce((sum, c) => sum + c.width, 0) + Math.max(0, columns.length - 1) * gap;

/** One row: the cells fitted to their columns and joined by `gap` spaces; missing cells are blank. */
export const gridRow = (columns: readonly GridColumn[], cells: readonly string[], gap = 1): string =>
  columns.map((c, i) => fitCell(cells[i] ?? '', c.width, c.align)).join(' '.repeat(gap));

export { fixed } from '../values/format.ts';
