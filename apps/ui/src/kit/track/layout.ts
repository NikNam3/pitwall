// The track canvas' pure layout (spec 7.1): fits the outline into the box and places the labels, the side bars and the
// marker labels so that nothing collides. Greedy, in a fixed order (labels by lap fraction, then bars, then marker
// labels); each tries its candidate positions in a fixed order and takes the first free one, so the same input always
// gives the same result.
import type { LapFraction, MapPoint } from '@pitwall/domain';
import type { Placed, TrackScene, TrackStretch } from './types.ts';

/** The px sizes the canvas draws with; the layout keeps clear of them. */
export const TRACK_PX = {
  /** The outline's stroke width. */
  line: 3,
  /** A stretch's stroke width. */
  stretch: 4,
  /** A hollow dot's ring width. */
  ring: 1.5,
  /** A marker triangle's side, centred at its point. */
  triangle: 10,
  /** A marker triangle's stroke width. */
  triangleLine: 2,
} as const;

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Circle = { x: number; y: number; r: number };
type TextBox = { text: string; x: number; y: number };
type Bar = Placed['bars'][number];

/** The margin around the fitted outline, in line heights: room for a label outside its outermost points. */
const MARGIN_LINES = 3;
/** How far along the outline (in line heights, each way) the bend at a point is judged. */
const BEND_REACH_LINES = 2;
/** A bend shallower than this share of its reach counts as straight. */
const STRAIGHT = 0.05;
/** Gaps (px) between a label and its point, nearest first. */
const LABEL_GAPS = [2, 5, 9, 14, 20, 27, 35] as const;
/** Directions (degrees from outside the bend) a label tries: those near it at every gap first, then the rest. */
const LABEL_TURNS = [
  [0, 30, -30, 60, -60],
  [90, -90, 120, -120, 150, -150, 180],
] as const;
/** The clear space kept around a label (px). */
const LABEL_PAD = 2;
/** The gap between a dot's edge and its side bar (px), and the clear space kept around a bar. */
const BAR_GAP = 2;
const BAR_PAD = 1;
const BAR_W = 3;
const BAR_H = 12;

/** Fits the outline's bounding box into the box with a margin, centred, one scale for x and y (y down). */
function fitOutline(outline: MapPoint[], box: { width: number; height: number }, lineHeight: number): (p: MapPoint) => Pt {
  if (outline.length === 0) return () => ({ x: box.width / 2, y: box.height / 2 });
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = Math.min(MARGIN_LINES * lineHeight, box.width / 4, box.height / 4);
  const scaleX = maxX > minX ? (box.width - 2 * margin) / (maxX - minX) : Infinity;
  const scaleY = maxY > minY ? (box.height - 2 * margin) / (maxY - minY) : Infinity;
  const fitted = Math.min(scaleX, scaleY);
  const scale = Number.isFinite(fitted) ? Math.max(0, fitted) : 0;
  const offX = box.width / 2 - ((minX + maxX) / 2) * scale;
  const offY = box.height / 2 - ((minY + maxY) / 2) * scale;
  return (p) => ({ x: offX + p.x * scale, y: offY + p.y * scale });
}

/** The item at index `i` of a closed list, wrapping both ways (callers never pass an empty list). */
function ring<T>(list: readonly T[], i: number): T {
  const n = list.length;
  const item = list[((i % n) + n) % n];
  if (item === undefined) throw new Error('ring of no items');
  return item;
}

/** The index of the outline point nearest to `p`; the first of equals. */
function nearestIndex(line: Pt[], p: Pt): number {
  let best = 0;
  let bestD = Infinity;
  line.forEach((q, i) => {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** The first point `step` (+1 or -1) along the closed outline from `i` at least `reach` px away from it. */
function walk(line: Pt[], i: number, step: 1 | -1, reach: number): Pt {
  const n = line.length;
  const p = ring(line, i);
  let q = p;
  for (let k = 1; k < n / 2; k++) {
    q = ring(line, i + step * k);
    if (Math.hypot(q.x - p.x, q.y - p.y) >= reach) break;
  }
  return q;
}

function unit(v: Pt): Pt | undefined {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len } : undefined;
}

function rotate(v: Pt, degrees: number): Pt {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * The unit direction outside the bend of the outline at point `i`: away from the centre of its curvature, or, on a
 * straight, along the normal pointing away from the outline's centre.
 */
function outsideOfBend(line: Pt[], i: number, reach: number, centre: Pt): Pt {
  const p = ring(line, i);
  const fromCentre = unit({ x: p.x - centre.x, y: p.y - centre.y }) ?? { x: 0, y: -1 };
  if (line.length < 3) return fromCentre;
  const a = walk(line, i, -1, reach);
  const b = walk(line, i, 1, reach);
  const bend = { x: p.x - (a.x + b.x) / 2, y: p.y - (a.y + b.y) / 2 };
  const out = Math.hypot(bend.x, bend.y) >= STRAIGHT * reach ? unit(bend) : undefined;
  if (out !== undefined) return out;
  const tangent = unit({ x: b.x - a.x, y: b.y - a.y });
  if (tangent === undefined) return fromCentre;
  const normal = { x: tangent.y, y: -tangent.x };
  const away = (p.x - centre.x) * normal.x + (p.y - centre.y) * normal.y;
  return away < 0 ? { x: -normal.x, y: -normal.y } : normal;
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/** Two rectangles share area (touching edges do not). */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A circle and a rectangle share area (touching does not). */
function circleOverlapsRect(c: Circle, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r ** 2;
}

/** The segment p-q passes through the inside of the rectangle (Liang-Barsky clipping on the open rectangle). */
function segmentCrossesRect(p: Pt, q: Pt, r: Rect): boolean {
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

/** What a placed piece must keep clear of: the line, the dots, every rectangle placed so far, the box's edges. */
type Obstacles = { line: Pt[]; dots: Circle[]; rects: Rect[]; box: { width: number; height: number } };

/** The rectangle lies inside the box and, with `pad` around it, clear of the line, the dots and the placed rectangles. */
function isFree(r: Rect, pad: number, o: Obstacles): boolean {
  if (r.x < 0 || r.y < 0 || r.x + r.w > o.box.width || r.y + r.h > o.box.height) return false;
  const padded = inflate(r, pad);
  if (o.rects.some((q) => rectsOverlap(q, padded))) return false;
  if (o.dots.some((c) => circleOverlapsRect(c, padded))) return false;
  const n = o.line.length;
  return n < 2 || !o.line.some((p, i) => segmentCrossesRect(p, ring(o.line, i + 1), padded));
}

/**
 * Places a text box beside the point `p`, `clearance` px away from it (a triangle's half size), first in the direction
 * `out`; undefined when no candidate is free.
 */
function placeText(text: string, p: Pt, out: Pt, clearance: number, size: { w: number; h: number }, o: Obstacles): TextBox | undefined {
  for (const turns of LABEL_TURNS) {
    for (const gap of LABEL_GAPS) {
      for (const turn of turns) {
        const d = rotate(out, turn);
        // the distance from the box's centre to its edge along d: the gap is measured from the box's edge
        const alongX = Math.abs(d.x) > 1e-9 ? size.w / 2 / Math.abs(d.x) : Infinity;
        const alongY = Math.abs(d.y) > 1e-9 ? size.h / 2 / Math.abs(d.y) : Infinity;
        const dist = clearance + gap + Math.min(alongX, alongY);
        const r = { x: p.x + d.x * dist - size.w / 2, y: p.y + d.y * dist - size.h / 2, w: size.w, h: size.h };
        if (isFree(r, LABEL_PAD, o)) return { text, x: r.x, y: r.y };
      }
    }
  }
  return undefined;
}

/** A side bar's rectangle on each side of a dot, in the order they are tried: right, left, above, below. */
function barSides(c: Circle): [Rect, Rect, Rect, Rect] {
  const off = c.r + BAR_GAP;
  return [
    { x: c.x + off, y: c.y - BAR_H / 2, w: BAR_W, h: BAR_H },
    { x: c.x - off - BAR_W, y: c.y - BAR_H / 2, w: BAR_W, h: BAR_H },
    { x: c.x - BAR_W / 2, y: c.y - off - BAR_H, w: BAR_W, h: BAR_H },
    { x: c.x - BAR_W / 2, y: c.y + off, w: BAR_W, h: BAR_H },
  ];
}

/** The square a marker's triangle is drawn in, centred at its point (px). */
export function triangleBox(at: { x: number; y: number }): Rect {
  const s = TRACK_PX.triangle;
  return { x: at.x - s / 2, y: at.y - s / 2, w: s, h: s };
}

/**
 * Fits the outline into the box with a margin, keeping its aspect; places each label outside the bend at its point,
 * each side bar on the first free side (right, left, above, below) of its dot, each marker label beside its triangle.
 * A label or marker label with no free place is left out (labels never overlap); a bar with no free side goes right
 * of its dot.
 */
export function layoutTrack(
  scene: TrackScene,
  box: { width: number; height: number },
  textWidth: (s: string) => number,
  lineHeight: number,
): Placed {
  const toPx = fitOutline(scene.outline, box, lineHeight);
  const line = scene.outline.map(toPx);
  // the fit centres the outline in the box
  const centre = { x: box.width / 2, y: box.height / 2 };
  const reach = BEND_REACH_LINES * lineHeight;
  const dots = scene.dots.map((d) => ({ ...toPx(d.at), r: d.radiusPx }));
  const placedRects: Rect[] = scene.markers.map((m) => triangleBox(toPx(m.at)));
  const obstacles: Obstacles = { line, dots, rects: placedRects, box };
  const sizeOf = (text: string) => ({ w: textWidth(text), h: lineHeight });
  const indexOf = (p: Pt) => (line.length > 0 ? nearestIndex(line, p) : 0);
  const outAt = (p: Pt) => (line.length > 0 ? outsideOfBend(line, indexOf(p), reach, centre) : { x: 0, y: -1 });
  const place = (into: TextBox[], text: string, p: Pt, clearance: number) => {
    const size = sizeOf(text);
    const placed = placeText(text, p, outAt(p), clearance, size, obstacles);
    if (placed === undefined) return;
    into.push(placed);
    placedRects.push({ x: placed.x, y: placed.y, ...size });
  };

  // labels by lap fraction (the index of their nearest outline point), ties in input order
  const byFraction = scene.labels
    .map((l, k) => ({ l, k, p: toPx(l.at) }))
    .map((e) => ({ ...e, i: indexOf(e.p) }))
    .sort((a, b) => a.i - b.i || a.k - b.k);
  const labels: TextBox[] = [];
  for (const { l, p } of byFraction) place(labels, l.text, p, 0);

  const bars: Bar[] = [];
  scene.dots.forEach((d, k) => {
    const dot = dots[k];
    if (d.bar === undefined || dot === undefined) return;
    const sides = barSides(dot);
    const side = sides.find((r) => isFree(r, BAR_PAD, obstacles)) ?? sides[0];
    bars.push({ x: side.x, y: side.y, w: BAR_W, h: BAR_H, role: d.bar, dotId: d.id });
    placedRects.push(side);
  });

  const markerLabels: TextBox[] = [];
  for (const m of scene.markers) place(markerLabels, m.label, toPx(m.at), TRACK_PX.triangle / 2);

  return { scene, toPx, labels, bars, markerLabels };
}

/** The map point at a lap fraction of the outline (point i of n at i / n), between its two neighbours; wraps past 1. */
function pointAt(outline: MapPoint[], fraction: LapFraction): MapPoint {
  const x = fraction * outline.length;
  const i = Math.floor(x);
  const t = x - i;
  const a = ring(outline, i);
  const b = ring(outline, i + 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The map points of a stretch: its start, every outline point inside it, its end. A stretch whose end lies past 1
 * runs on across the line; one of no length has no points, one of a lap or more is the whole outline once.
 */
export function stretchPoints(outline: MapPoint[], stretch: TrackStretch): MapPoint[] {
  const n = outline.length;
  if (n === 0 || !(stretch.end > stretch.start)) return [];
  const { start } = stretch;
  const end = Math.min(stretch.end, start + 1);
  const eps = 1e-9;
  const points = [pointAt(outline, start)];
  for (let i = Math.floor(start * n) + 1; i / n < end - eps; i++) {
    if (i / n > start + eps) points.push(ring(outline, i));
  }
  points.push(pointAt(outline, end));
  return points;
}
