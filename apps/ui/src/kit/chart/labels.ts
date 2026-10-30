/** Pure helpers of the chart's end-of-line labels: which lines get one, and where they go without overlapping. */
import type { ChartSeries } from './data.ts';

/** A line's label: `index` is the series' index, `x` and `value` the x and y of its last point in the visible range. */
export type EndLabel = { index: number; text: string; x: number; value: number; bold: boolean };

/**
 * How far before the newest x a line must end to be labelled at its own end instead of in the column, per x kind: a
 * car on the lead lap ends within a lap of the newest x (each car counts its own laps), a lapped or retired car
 * further back; on session time, a line without a point for a minute has stopped.
 */
export const EARLY_END = { lap: 1, sessionTime: 60_000 } as const;

/** Whether the label's line ends so far before the range's end (the newest x) that it is labelled at its own end. */
export const endsEarly = (label: EndLabel, [, hi]: [number, number], kind: keyof typeof EARLY_END): boolean => hi - label.x >= EARLY_END[kind];

/** One label per series with a point in `range` (inclusive), in series order; an own car's label is bold. */
export function endLabels(series: ChartSeries[], [lo, hi]: [number, number]): EndLabel[] {
  const out: EndLabel[] = [];
  series.forEach((s, index) => {
    let last: [number, number] | undefined;
    for (const p of s.points) if (p[0] >= lo && p[0] <= hi && (last === undefined || p[0] > last[0])) last = p;
    if (last !== undefined) out.push({ index, text: s.label, x: last[0], value: last[1], bold: s.colour?.ownCar === true });
  });
  return out;
}

/**
 * Which labels keep their place when only `capacity` fit: every one of ours first, then the others nearest to one of
 * ours by end; without ours, the topmost. Returns the kept indices.
 */
function keptLabels(ends: number[], capacity: number, ours: readonly boolean[]): number[] {
  const own = ends.flatMap((end, i) => (ours[i] === true ? [end] : []));
  const distance = (end: number): number => (own.length === 0 ? end : Math.min(...own.map((o) => Math.abs(end - o))));
  return ends
    .map((end, i) => ({ i, mine: ours[i] === true, d: distance(end) }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.d - b.d)
    .slice(0, Math.max(0, capacity))
    .map((k) => k.i);
}

/**
 * Label centres for line ends given as plot-relative pixel ys (0 the top), in input order. Labels closer than `rowPx`
 * form a group centred on its ends, a row apart, in end order; every centre stays in `[rowPx / 2, heightPx - rowPx / 2]`.
 * When they cannot all fit a row apart, only `floor(heightPx / rowPx)` keep one (`keptLabels`: `ours[i]` marks our
 * cars); a dropped label is `undefined`.
 */
export function placeLabels(ends: number[], rowPx: number, heightPx: number, ours: readonly boolean[] = []): Array<number | undefined> {
  const capacity = Math.floor(heightPx / rowPx);
  if (ends.length <= capacity) return spread(ends, rowPx, heightPx);
  const kept = keptLabels(ends, capacity, ours);
  const placed = spread(kept.map((i) => ends[i] ?? 0), rowPx, heightPx);
  const out = new Array<number | undefined>(ends.length).fill(undefined);
  kept.forEach((i, k) => (out[i] = placed[k]));
  return out;
}

/** Centres for labels that fit a row apart: groups of labels closer than a row, each centred on its ends. */
function spread(ends: number[], rowPx: number, heightPx: number): number[] {
  const lo = rowPx / 2;
  const hi = heightPx - rowPx / 2;
  const order = ends.map((end, i) => ({ end, i })).sort((a, b) => a.end - b.end);
  // Groups of labels a row apart: the first label's centre, how many and the sum of their ends.
  const groups: Array<{ top: number; count: number; sum: number }> = [];
  const place = (sum: number, count: number): number => {
    const top = sum / count - ((count - 1) * rowPx) / 2;
    return Math.max(lo, Math.min(hi - (count - 1) * rowPx, top));
  };
  for (const { end } of order) {
    let group = { top: place(end, 1), count: 1, sum: end };
    let prev = groups.at(-1);
    while (prev !== undefined && prev.top + prev.count * rowPx > group.top) {
      groups.pop();
      const count = prev.count + group.count;
      const sum = prev.sum + group.sum;
      group = { top: place(sum, count), count, sum };
      prev = groups.at(-1);
    }
    groups.push(group);
  }
  const out = new Array<number>(ends.length);
  const tops = groups.flatMap((g) => Array.from({ length: g.count }, (_, j) => g.top + j * rowPx));
  order.forEach(({ i }, k) => (out[i] = tops[k] ?? lo));
  return out;
}
