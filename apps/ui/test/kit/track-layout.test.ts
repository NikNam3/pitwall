// The track canvas' pure layout (spec 7.1): `layoutTrack(scene, box, textWidth, lineHeight)` fits the outline into the
// box and places the labels, the side bars and the marker labels so that nothing collides.
// Geometry the tests assume of `Placed` (all CSS px in the box, origin top-left, y down):
//  - `toPx` maps a map point (unit square, y down) by one scale for x and y and an offset: the outline's bounding box
//    is centred in the box, scaled as large as the margin allows, the margin the same on the side that limits the fit;
//  - a label and a marker label `{ text, x, y }` is the box of its text: top-left (x, y), `textWidth(text)` wide and
//    `lineHeight` high;
//  - a side bar `{ x, y, w: 3, h: 12 }` is its rectangle, top-left (x, y); it is beside its dot, within 8 px of the dot's
//    edge, on a side: right or left (the bar's height spans the dot's centre), above or below (its width spans it);
//  - a dot is the circle of `radiusPx` around `toPx(at)`; the line is the closed polyline through `toPx` of the outline,
//    crossed when a segment passes through a box's inside.
import { describe, expect, it } from 'vitest';
import type { MapPoint } from '@pitwall/domain';
import { layoutTrack } from '../../src/kit/track/layout.ts';
import type { Placed, TrackDot, TrackScene } from '../../src/kit/track/types.ts';
import { circleOverlapsRect, ellipse, polylineCrossesRect, rectangle, rectsOverlap, type Rect } from './track-fixtures.ts';

const CHAR_PX = 8;
const LINE = 14;
const textWidth = (s: string): number => s.length * CHAR_PX;
const team = { colour: '#00a7af', ownCar: false };

const scene = (over: Partial<TrackScene>): TrackScene => ({
  outline: ellipse(120),
  lineRole: 'textFaint',
  stretches: [],
  labels: [],
  dots: [],
  markers: [],
  ghosts: [],
  ...over,
});
const dot = (id: string, at: MapPoint, over: Partial<TrackDot> = {}): TrackDot => ({ id, at, colour: team, radiusPx: 4, hollow: false, ...over });

const textBox = (l: { text: string; x: number; y: number }): Rect => ({ x: l.x, y: l.y, w: textWidth(l.text), h: LINE });
const barBox = (b: Placed['bars'][number]): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const dotCircle = (placed: Placed, d: TrackDot) => ({ ...placed.toPx(d.at), r: d.radiusPx });
const linePx = (placed: Placed) => placed.scene.outline.map((p) => placed.toPx(p));

/** The px bounding box of the fitted outline and its gaps to the box's edges. */
function fit(placed: Placed, box: { width: number; height: number }) {
  const px = linePx(placed);
  const xs = px.map((p) => p.x);
  const ys = px.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { px, minX, maxX, minY, maxY, left: minX, right: box.width - maxX, top: minY, bottom: box.height - maxY };
}

describe('layoutTrack: the fit', () => {
  // The ellipse's bounding box is 0.9 x 0.4: wider than a 600 x 400 box, so its width limits the fit; taller than a
  // 1200 x 400 box, so there its height does.
  it.each([
    ['width', { width: 600, height: 400 }],
    ['height', { width: 1200, height: 400 }],
  ] as const)('fits the outline inside the box with the margin, centred, the %s limiting', (limiting, box) => {
    const f = fit(layoutTrack(scene({}), box, textWidth, LINE), box);
    for (const p of f.px) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(box.width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(box.height);
    }
    expect(f.left).toBeCloseTo(f.right, 6);
    expect(f.top).toBeCloseTo(f.bottom, 6);
    const [margin, other] = limiting === 'width' ? [f.left, f.top] : [f.top, f.left];
    expect(margin).toBeGreaterThan(0);
    expect(other).toBeGreaterThanOrEqual(margin);
  });

  it('keeps the aspect: one scale for x and y, y down', () => {
    const placed = layoutTrack(scene({}), { width: 600, height: 400 }, textWidth, LINE);
    const o = placed.toPx({ x: 0.5, y: 0.5 });
    const dx = placed.toPx({ x: 0.7, y: 0.5 });
    const dy = placed.toPx({ x: 0.5, y: 0.7 });
    const s = (dx.x - o.x) / 0.2;
    expect(s).toBeGreaterThan(0);
    expect(dx.y).toBeCloseTo(o.y, 6);
    expect(dy.x).toBeCloseTo(o.x, 6);
    expect((dy.y - o.y) / 0.2).toBeCloseTo(s, 6);
    const f = fit(placed, { width: 600, height: 400 });
    expect((f.maxX - f.minX) / (f.maxY - f.minY)).toBeCloseTo(0.9 / 0.4, 3);
  });
});

describe('layoutTrack: labels', () => {
  it('places a label outside the bend at its point', () => {
    const outline = ellipse(120);
    const box = { width: 600, height: 400 };
    const right = layoutTrack(scene({ outline, labels: [{ text: 'T1', at: outline[0]! }] }), box, textWidth, LINE);
    const r = textBox(right.labels[0]!);
    expect(r.x + r.w / 2).toBeGreaterThan(right.toPx(outline[0]!).x);
    const top = layoutTrack(scene({ outline, labels: [{ text: 'T5', at: outline[90]! }] }), box, textWidth, LINE);
    const t = textBox(top.labels[0]!);
    expect(t.y + t.h / 2).toBeLessThan(top.toPx(outline[90]!).y);
  });

  // A race map: turn and sector labels, 20 cars (some at a label's point, the own car larger, a car in the pit hollow,
  // two under blue with a side bar) and two incident markers.
  const outline = ellipse(120);
  const turns = [0, 14, 29, 43, 58, 72, 87, 101].map((i, k) => ({ text: `T${k + 1}`, at: outline[i]! }));
  const sectors = [{ text: 'S2', at: outline[40]! }, { text: 'S3', at: outline[80]! }];
  const dots = Array.from({ length: 20 }, (_, k) =>
    dot(`car${k}`, outline[k * 6]!, {
      ...(k === 0 ? { colour: { colour: 'var(--pw-ownCar)', ownCar: true }, radiusPx: 6 } : {}),
      ...(k === 7 ? { hollow: true } : {}),
      ...(k === 3 || k === 11 ? { bar: 'flagBlue' as const } : {}),
    }),
  );
  const markers = [
    { at: outline[22]!, label: 'Spin', role: 'warning' as const },
    { at: outline[65]!, label: 'Collision', role: 'warning' as const },
  ];
  const race = scene({ outline, labels: [...turns, ...sectors], dots, markers });
  const BOX = { width: 600, height: 400 };
  // Laid out once, on first use, so an unimplemented layout fails each test rather than the file.
  let laidOut: Placed | undefined;
  const placedRace = (): Placed => (laidOut ??= layoutTrack(race, BOX, textWidth, LINE));
  const allLabels = (): Rect[] => [...placedRace().labels, ...placedRace().markerLabels].map(textBox);

  it('places every label, every marker label and every side bar', () => {
    const placed = placedRace();
    expect(placed.labels.map((l) => l.text).sort()).toEqual([...turns, ...sectors].map((l) => l.text).sort());
    expect(placed.markerLabels.map((l) => l.text).sort()).toEqual(['Collision', 'Spin']);
    expect(placed.bars.map((b) => b.dotId).sort()).toEqual(['car11', 'car3']);
    expect(placed.bars.every((b) => b.role === 'flagBlue' && b.w === 3 && b.h === 12)).toBe(true);
  });

  it('no two placed labels overlap', () => {
    const boxes = allLabels();
    const clashes = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => rectsOverlap(a, b)).map((b) => [a, b]));
    expect(clashes).toEqual([]);
  });

  it('no label overlaps a dot', () => {
    const placed = placedRace();
    const clashes = allLabels().filter((l) => dots.some((d) => circleOverlapsRect(dotCircle(placed, d), l)));
    expect(clashes).toEqual([]);
  });

  it('no label crosses the outline', () => {
    const line = linePx(placedRace());
    expect(allLabels().filter((l) => polylineCrossesRect(line, l))).toEqual([]);
  });

  it('every label lies inside the box', () => {
    const outside = allLabels().filter((l) => l.x < 0 || l.y < 0 || l.x + l.w > BOX.width || l.y + l.h > BOX.height);
    expect(outside).toEqual([]);
  });

  it('the same input gives the same result twice', () => {
    const placed = placedRace();
    const again = layoutTrack(race, BOX, textWidth, LINE);
    expect(again.labels).toEqual(placed.labels);
    expect(again.bars).toEqual(placed.bars);
    expect(again.markerLabels).toEqual(placed.markerLabels);
    expect(again.scene).toEqual(placed.scene);
    expect(outline.map((p) => again.toPx(p))).toEqual(outline.map((p) => placed.toPx(p)));
  });
});

describe('layoutTrack: side bars', () => {
  // The rectangle's left side is a vertical stretch (x 0.1), its top a horizontal one (y 0.2). A dot on a vertical
  // stretch has the line above and below it, one on a horizontal stretch has it right and left of it.
  const outline = rectangle(40);
  const BOX = { width: 600, height: 400 };
  const onLeft: MapPoint = { x: 0.1, y: 0.5 };
  const onTop: MapPoint = { x: 0.5, y: 0.2 };
  /** The map point `dx`, `dy` px from `p`, by the fit of the bare outline (the fit depends on the outline and box only). */
  const offset = (p: MapPoint, dx: number, dy: number): MapPoint => {
    const base = layoutTrack(scene({ outline }), BOX, textWidth, LINE);
    const scale = base.toPx({ x: 1, y: 0 }).x - base.toPx({ x: 0, y: 0 }).x;
    return { x: p.x + dx / scale, y: p.y + dy / scale };
  };

  type Side = 'right' | 'left' | 'above' | 'below';
  function sideOf(b: Rect, c: { x: number; y: number; r: number }): Side | 'none' {
    const eps = 1e-6;
    const spansY = b.y <= c.y && c.y <= b.y + b.h;
    const spansX = b.x <= c.x && c.x <= b.x + b.w;
    if (spansY && b.x >= c.x + c.r - eps && b.x <= c.x + c.r + 8) return 'right';
    if (spansY && b.x + b.w <= c.x - c.r + eps && b.x + b.w >= c.x - c.r - 8) return 'left';
    if (spansX && b.y + b.h <= c.y - c.r + eps && b.y + b.h >= c.y - c.r - 8) return 'above';
    if (spansX && b.y >= c.y + c.r - eps && b.y <= c.y + c.r + 8) return 'below';
    return 'none';
  }

  /** Lays out the car with the bar and the blocking cars; returns its bar's side and whether it touches anything. */
  function barOf(at: MapPoint, blockers: TrackDot[]) {
    const car = dot('car', at, { bar: 'flagBlue' });
    const placed = layoutTrack(scene({ outline, dots: [car, ...blockers] }), BOX, textWidth, LINE);
    const bar = placed.bars.find((b) => b.dotId === 'car');
    if (bar === undefined) throw new Error('no bar for the car');
    const box = barBox(bar);
    const touches =
      [car, ...blockers].some((d) => circleOverlapsRect(dotCircle(placed, d), box)) ||
      polylineCrossesRect(linePx(placed), box) ||
      placed.labels.map(textBox).some((l) => rectsOverlap(l, box));
    return { side: sideOf(box, dotCircle(placed, car)), touches };
  }

  it('goes right of its dot when nothing is there (a dot on a vertical stretch)', () => {
    expect(barOf(onLeft, [])).toEqual({ side: 'right', touches: false });
  });

  it('goes left when a dot is right of it', () => {
    expect(barOf(onLeft, [dot('blocker', offset(onLeft, 10, 0), { radiusPx: 6 })])).toEqual({ side: 'left', touches: false });
  });

  it('goes above when the line runs right and left of it (a dot on a horizontal stretch)', () => {
    expect(barOf(onTop, [])).toEqual({ side: 'above', touches: false });
  });

  it('goes below when the line runs right and left of it and a dot is above it', () => {
    expect(barOf(onTop, [dot('blocker', offset(onTop, 0, -10), { radiusPx: 6 })])).toEqual({ side: 'below', touches: false });
  });

  it('touches no label placed at its dot', () => {
    const car = dot('car', onLeft, { bar: 'flagBlue' });
    const placed = layoutTrack(scene({ outline, dots: [car], labels: [{ text: 'T9', at: onLeft }] }), BOX, textWidth, LINE);
    const bar = placed.bars.find((b) => b.dotId === 'car');
    if (bar === undefined) throw new Error('no bar for the car');
    expect(placed.labels.map(textBox).filter((l) => rectsOverlap(l, barBox(bar)))).toEqual([]);
    expect(sideOf(barBox(bar), dotCircle(placed, car))).not.toBe('none');
  });
});
