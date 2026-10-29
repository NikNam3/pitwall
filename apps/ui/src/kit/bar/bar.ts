// The cells of a `Bar` (spec 8.4, A.4): pure, so the display only prints the text.
import type { Known, UnknownReason } from '@pitwall/domain';

/** One character per cell kind; whole cells only, so the bar obeys the character-cell sizing. */
export const BAR_CHARS = { fill: '█', empty: '░', limit: '|', marker: ':', reserve: '¦' } as const;
export type BarCellKind = keyof typeof BAR_CHARS;

export type BarInput = {
  value: Known<number>;
  min: number;
  max: number;
  cols: number;
  limit?: number | undefined;
  marker?: Known<number> | undefined;
  reserve?: number | undefined;
};
export type BarCells = { text: string; kinds: BarCellKind[]; over: boolean; reason: UnknownReason | undefined };

/** Cells of a bar: the fill, then the reserve, marker and limit drawn over it (limit wins on one cell). */
export function barCells({ value, min, max, cols, limit, marker, reserve }: BarInput): BarCells {
  const span = max - min;
  const frac = (v: number): number => (v - min) / span;
  const kinds: BarCellKind[] = Array.from({ length: cols }, () => 'empty');
  const over = value.known && value.value > max;
  if (value.known) {
    const filled = Math.min(cols, Math.max(0, Math.round(frac(value.value) * cols)));
    for (let i = 0; i < filled; i++) kinds[i] = 'fill';
  }
  const put = (p: number | undefined, kind: BarCellKind): void => {
    if (p === undefined) return;
    kinds[Math.min(cols - 1, Math.max(0, Math.floor(frac(p) * cols)))] = kind;
  };
  put(reserve, 'reserve');
  put(marker?.known ? marker.value : undefined, 'marker');
  put(limit, 'limit');
  return { text: kinds.map((k) => BAR_CHARS[k]).join(''), kinds, over, reason: value.known ? undefined : value.reason };
}
