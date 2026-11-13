// The distribution strip's geometry (SP4.3b2; docs/design/2026-11-12-sp4.3b gen.mjs `DIST`): one cell per bin, a bar per
// non-zero bin from a common baseline, its height the bin's chance against a scale shared by the rows (Q2 A).
import type { Role } from '../../theme/index.ts';

/** One bar: its left edge and width inside its cell, its height, its theme role. */
export type Bar = { x: number; w: number; h: number; role: Role };

/** Where zero is: between bins `between − 1` and `between` (continuous bins), or under a bin's centre (whole places). */
export type GainZero = { between: number } | { underBin: number };

/** The box the bars stand in: `w` across every cell, `h` the height of a bin at the scale. */
export type Box = { w: number; h: number };

/** The gap left and right of a bar, as a share of its cell (the mockup's 1 px of a 8.6 px cell). */
const INSET = 1 / 8;

/** The largest bin over every series, so rows compare; 1 when there is none (or every bin is 0). */
export function sharedScale(series: readonly (readonly number[])[]): number {
  let max = 0;
  for (const s of series) for (const p of s) if (p > max) max = p;
  return max > 0 ? max : 1;
}

function bars(bins: readonly number[], scale: number, box: Box, roleOf: (i: number) => Role): Bar[] {
  const cell = box.w / bins.length;
  const out: Bar[] = [];
  bins.forEach((p, i) => {
    if (!(p > 0)) return;
    out.push({ x: i * cell + cell * INSET, w: cell * (1 - 2 * INSET), h: (box.h * p) / scale, role: roleOf(i) });
  });
  return out;
}

/** The bars of a place distribution (P1 … Pn): `text`, every bar `ownCar` when lit. */
export const placeBars = (pmf: readonly number[], scale: number, box: Box, lit = false): Bar[] =>
  bars(pmf, scale, box, () => (lit ? 'ownCar' : 'text'));

/** The bin index zero sits at: bins before it are below zero. */
export const zeroBin = (zero: GainZero): number => ('between' in zero ? zero.between : zero.underBin);

/** The bars of a gain distribution: below zero `textFaint`, the rest `textDim`, every bar `ownCar` when lit. */
export function gainBars(bins: readonly number[], scale: number, box: Box, zero: GainZero, lit = false): Bar[] {
  const at = zeroBin(zero);
  return bars(bins, scale, box, (i) => (lit ? 'ownCar' : i < at ? 'textFaint' : 'textDim'));
}
