/** Pure helpers of the chart's end-of-line labels: which lines get one, and where they go without overlapping. */
import type { ChartSeries } from './data.ts';

/** A line's label: `index` is the series' index, `value` the y of its last point in the visible range. */
export type EndLabel = { index: number; text: string; value: number; bold: boolean };

/** One label per series with a point in `range` (inclusive), in series order; an own car's label is bold. */
export function endLabels(series: ChartSeries[], [lo, hi]: [number, number]): EndLabel[] {
  const out: EndLabel[] = [];
  series.forEach((s, index) => {
    let last: [number, number] | undefined;
    for (const p of s.points) if (p[0] >= lo && p[0] <= hi && (last === undefined || p[0] > last[0])) last = p;
    if (last !== undefined) out.push({ index, text: s.label, value: last[1], bold: s.colour?.ownCar === true });
  });
  return out;
}

/**
 * Label centres for line ends given as plot-relative pixel ys (0 the top), in input order. Labels closer than `rowPx`
 * form a group centred on its ends, a row apart, in end order; every centre stays in `[rowPx / 2, heightPx - rowPx / 2]`.
 * When the labels cannot all fit, the row shrinks so they still span the plot in order.
 */
export function placeLabels(ends: number[], rowPx: number, heightPx: number): number[] {
  const n = ends.length;
  const lo = rowPx / 2;
  const hi = heightPx - rowPx / 2;
  const step = n > 1 ? Math.min(rowPx, Math.max(0, hi - lo) / (n - 1)) : rowPx;
  const order = ends.map((end, i) => ({ end, i })).sort((a, b) => a.end - b.end);
  // Groups of labels a step apart: the first label's centre, how many and the sum of their ends.
  const groups: Array<{ top: number; count: number; sum: number }> = [];
  const place = (sum: number, count: number): number => {
    const top = sum / count - ((count - 1) * step) / 2;
    return Math.max(lo, Math.min(hi - (count - 1) * step, top));
  };
  for (const { end } of order) {
    let group = { top: place(end, 1), count: 1, sum: end };
    let prev = groups.at(-1);
    while (prev !== undefined && prev.top + prev.count * step > group.top) {
      groups.pop();
      const count = prev.count + group.count;
      const sum = prev.sum + group.sum;
      group = { top: place(sum, count), count, sum };
      prev = groups.at(-1);
    }
    groups.push(group);
  }
  const out = new Array<number>(n);
  const tops = groups.flatMap((g) => Array.from({ length: g.count }, (_, j) => g.top + j * step));
  order.forEach(({ i }, k) => (out[i] = tops[k] ?? lo));
  return out;
}
