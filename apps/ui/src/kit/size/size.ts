/** Size in character cells: pure helpers that measure panels and drop table columns by priority. */

export type Cell = { width: number; height: number };

/** Size of one character cell in px: 0.6 x the font size wide, font size x line height high. */
export function cellBox(fontPx: number, lineHeight: number): Cell {
  return { width: 0.6 * fontPx, height: fontPx * lineHeight };
}

/** Whole character cells that fit in a pixel box. */
export function toCells(
  px: { width: number; height: number },
  cell: Cell,
): { cols: number; rows: number } {
  return { cols: Math.floor(px.width / cell.width), rows: Math.floor(px.height / cell.height) };
}

/** The mode with the largest minCols x minRows that fits, or undefined when none does. */
export function pickMode(
  sizes: Record<string, { minCols: number; minRows: number }>,
  cols: number,
  rows: number,
): string | undefined {
  let best: string | undefined;
  let bestArea = -1;
  for (const [mode, { minCols, minRows }] of Object.entries(sizes)) {
    const area = minCols * minRows;
    if (minCols <= cols && minRows <= rows && area > bestArea) {
      best = mode;
      bestArea = area;
    }
  }
  return best;
}

function totalCols(widths: number[], gapCols: number): number {
  const sum = widths.reduce((a, b) => a + b, 0);
  return sum + gapCols * Math.max(0, widths.length - 1);
}

/**
 * Keys of the columns that fit in `cols`, in input order. Drops columns from the highest priority
 * number down (1 is most important); ties drop the rightmost first. `gapCols` is counted between neighbours.
 */
export function fitColumns<K extends string>(
  columns: Array<{ key: K; widthCols: number; priority: number }>,
  cols: number,
  gapCols: number,
): K[] {
  const kept = columns.map((c, index) => ({ ...c, index }));
  const dropOrder = [...kept].sort((a, b) => b.priority - a.priority || b.index - a.index);
  for (const victim of dropOrder) {
    if (totalCols(kept.map((c) => c.widthCols), gapCols) <= cols) break;
    kept.splice(kept.indexOf(victim), 1);
  }
  return kept.map((c) => c.key);
}
