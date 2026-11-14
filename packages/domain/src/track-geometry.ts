// Geometry on a track file's outline, one copy for the analyses and the ui kit.
import type { LapFraction, MapPoint } from './track-file.ts';

/** Wraps a number into [0, 1). */
function wrap01(value: number): number {
  const w = value - Math.floor(value);
  return w >= 1 ? 0 : w;
}

/**
 * The outline point at a lap fraction (point i of n at i / n): linear between point floor(f*n) and the next, wrapping
 * at the line and past 1. Throws on an empty outline or a non-finite fraction, which valid callers never pass.
 */
export function pointAt(outline: readonly MapPoint[], fraction: LapFraction): MapPoint {
  const n = outline.length;
  if (n === 0) throw new Error('pointAt: the outline is empty');
  if (!Number.isFinite(fraction)) throw new Error(`pointAt: the fraction is not finite (${fraction})`);
  const scaled = wrap01(fraction) * n;
  const i = Math.min(Math.floor(scaled), n - 1);
  const t = scaled - i;
  const a = outline[i];
  const b = outline[(i + 1) % n];
  if (a === undefined || b === undefined) throw new Error('pointAt: outline index out of range');
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
