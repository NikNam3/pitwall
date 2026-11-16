/** Pure geometry of the circle of doom: where a car sits, and which labels are drawn where (SP4.3d spec §6.5, P28). */
import type { CarId, Ms } from '@pitwall/domain';

/** A point relative to the circle's centre, in pixels; x grows right, y grows down (screen coordinates). */
export type Point = { x: number; y: number };

/**
 * Where a car `behindMs` behind our car sits on a circle of `radius` whose one turn is `lapMs`. Our car (0) is at the
 * top; the angle runs clockwise (seen on screen) from the top, so a car just behind is just right of the top and a car
 * just ahead (behindMs near `lapMs`) just left of it. Half a lap is at the bottom.
 */
export function polarOf(behindMs: Ms | number, lapMs: Ms | number, radius: number): Point {
  const angle = (behindMs / lapMs) * 2 * Math.PI - Math.PI / 2;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** A car to label: its id and driver code, and how far behind our car it is. */
export type LabelCar = { carId: CarId; code: string; behindMs: Ms | number };

export type LabelOptions = {
  /** One turn of the circle. */
  lapMs: Ms | number;
  /** The radius of the inner label ring; the arc between two labels is measured on it. */
  innerRadius: number;
  /** The radius of the outer ring a fanned-out label moves to. */
  outerRadius: number;
  /** A label's width in pixels. */
  labelWidth: number;
  /** Our car: not labelled here (the widget draws it at the top). */
  ourCar: CarId;
  /** Our teammate, if any: keeps its code in a group too tight to fan. */
  teammate?: CarId | undefined;
};

/** Which ring a label is drawn on, or `dot` for a car shown as a dot only (its code on hover). */
export type LabelRing = 'inner' | 'outer' | 'dot';

/** What to draw for one car: its ring and where its label goes (`label` is null for a dot). */
export type CarLabel = { carId: CarId; code: string; ring: LabelRing; label: Point | null };

/**
 * The label rule: cars are sorted by position from the top (cars just ahead of us, nearly a lap behind, come first, so
 * groups wrap around the top); neighbours closer than `labelWidth` on the inner ring form a group.
 * A single car takes the inner ring. A group fans out alternately (inner, outer, inner, ...) unless it is too tight:
 * three or more cars spanning under two label widths. A tight group keeps one code, the teammate's, else the car
 * closest to our car on the circle, and the others are dots. Our car is skipped. The result is in the sorted order.
 * Our car's label (drawn at the top by the widget) takes the inner slot at the top, so a car within a label width of
 * it goes to the outer ring (a dot if another car's label is there); our car is not a group member.
 */
export function placeCircleLabels(cars: readonly LabelCar[], opts: LabelOptions): CarLabel[] {
  const { lapMs, innerRadius, outerRadius, labelWidth } = opts;
  // Position on the circle as a signed time from the top: cars just ahead of us are negative, so the top is no seam.
  const offset = (c: LabelCar): number => (c.behindMs > lapMs / 2 ? c.behindMs - lapMs : c.behindMs);
  const arc = (a: LabelCar, b: LabelCar): number => (Math.abs(offset(a) - offset(b)) / lapMs) * 2 * Math.PI * innerRadius;
  const sorted = cars.filter((c) => c.carId !== opts.ourCar).sort((a, b) => offset(a) - offset(b));
  const groups: LabelCar[][] = [];
  for (const c of sorted) {
    const g = groups.at(-1);
    const last = g?.at(-1);
    if (g && last && arc(last, c) < labelWidth) g.push(c);
    else groups.push([c]);
  }
  const near = (c: LabelCar): number => Math.abs(offset(c));
  const rings = new Map<CarId, LabelRing>();
  for (const g of groups) {
    const first = g[0];
    const last = g.at(-1);
    const tight = g.length >= 3 && first && last && arc(first, last) < 2 * labelWidth;
    if (!tight || !first) {
      g.forEach((c, i) => rings.set(c.carId, i % 2 === 0 ? 'inner' : 'outer'));
      continue;
    }
    const keep = g.find((c) => c.carId === opts.teammate) ?? g.reduce((best, c) => (near(c) < near(best) ? c : best), first);
    for (const c of g) rings.set(c.carId, c === keep ? 'inner' : 'dot');
  }
  // Our car's label takes the inner slot at the top: a car within a label width of it never takes the inner ring. It
  // takes the outer ring if no car there is within a label width, else it is a dot.
  const ours: LabelCar = { carId: opts.ourCar, code: '', behindMs: 0 };
  const nearTop = sorted.filter((c) => rings.get(c.carId) !== 'dot' && arc(c, ours) < labelWidth);
  for (const c of nearTop) rings.delete(c.carId);
  for (const c of nearTop) {
    const taken = sorted.some((d) => d !== c && rings.get(d.carId) === 'outer' && arc(c, d) < labelWidth);
    rings.set(c.carId, taken ? 'dot' : 'outer');
  }
  return sorted.map((c) => {
    const ring = rings.get(c.carId) ?? 'inner';
    const label = ring === 'dot' ? null : polarOf(c.behindMs, lapMs, ring === 'inner' ? innerRadius : outerRadius);
    return { carId: c.carId, code: c.code, ring, label };
  });
}
