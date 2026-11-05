// Hand-made track outlines and the geometry the track layout tests check placements with. Map points are in the unit
// square, y down, like a track file's; point i of an outline of n points is at lap fraction i / n.
import type { MapPoint } from '@pitwall/domain';

/** A wide ellipse (bounding box 0.9 x 0.4, aspect 2.25) of `n` points; point 0 is the rightmost, n * 3/4 the top. */
export function ellipse(n: number): MapPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: 0.5 + 0.45 * Math.cos(a), y: 0.5 + 0.2 * Math.sin(a) };
  });
}

/**
 * A rectangle (0.1, 0.2) to (0.9, 0.8) walked clockwise from its top-left corner, `perSide` points per side: straight
 * horizontal stretches top and bottom, vertical ones left and right.
 */
export function rectangle(perSide: number): MapPoint[] {
  const [l, t, r, b] = [0.1, 0.2, 0.9, 0.8];
  const side = (from: MapPoint, to: MapPoint): MapPoint[] =>
    Array.from({ length: perSide }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / perSide, y: from.y + ((to.y - from.y) * i) / perSide }));
  return [
    ...side({ x: l, y: t }, { x: r, y: t }),
    ...side({ x: r, y: t }, { x: r, y: b }),
    ...side({ x: r, y: b }, { x: l, y: b }),
    ...side({ x: l, y: b }, { x: l, y: t }),
  ];
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Circle = { x: number; y: number; r: number };
type Pt = { x: number; y: number };

/** Two rectangles share area (touching edges do not). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A circle and a rectangle share area (touching does not). */
export function circleOverlapsRect(c: Circle, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r ** 2;
}

/** The segment p-q passes through the inside of the rectangle (running along an edge or touching a corner does not). */
export function segmentCrossesRect(p: Pt, q: Pt, r: Rect): boolean {
  // Liang-Barsky clipping against the open rectangle: a crossing leaves a piece of positive length strictly inside.
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clips: Array<[number, number]> = [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ];
  for (const [den, num] of clips) {
    if (den === 0) {
      if (num <= 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-9;
}

/** The closed polyline through `points` passes through the inside of the rectangle. */
export function polylineCrossesRect(points: Pt[], r: Rect): boolean {
  return points.some((p, i) => segmentCrossesRect(p, points[(i + 1) % points.length]!, r));
}
