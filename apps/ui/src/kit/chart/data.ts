/** Pure helpers of the chart: aligning series for uPlot and picking the visible x-range. */

export type ChartSeries = {
  label: string;
  points: Array<[x: number, y: number]>;
  /** False dims the series (its data is stale). */
  fresh?: boolean | undefined;
  /** A car series passes `carColour`'s result; own cars draw thicker. */
  colour?: { colour: string; dashed: boolean; ownCar: boolean } | undefined;
};

/** uPlot data: the sorted union of all x values, then each series' y at those x (null where it has none). */
export function buildData(series: ChartSeries[]): Array<Array<number | null>> {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
  return [xs, ...series.map((s) => {
    const byX = new Map(s.points);
    return xs.map((x) => byX.get(x) ?? null);
  })];
}

/**
 * The visible x-range: ends at the newest x and spans at most `cols` cells of `xPerCell[kind]` x units each, so width
 * shows history. With less history than that it starts at the first data point (never at negative laps); a single
 * point starts at max(0, end - span), or spans [end, end + span] when that would be degenerate.
 */
export function visibleXRange(
  xs: number[],
  cols: number,
  kind: 'lap' | 'sessionTime',
  xPerCell: { lap: number; sessionTime: number },
): [number, number] {
  const span = cols * xPerCell[kind];
  if (xs.length === 0) return [0, span];
  const end = xs.reduce((a, b) => Math.max(a, b));
  const first = xs.reduce((a, b) => Math.min(a, b));
  if (first === end) {
    const start = Math.max(0, end - span);
    return start === end ? [end, end + span] : [start, end];
  }
  return [Math.max(first, end - span), end];
}

/** A safety-car, virtual-safety-car or red-flag period on the x axis. */
export type PhaseBand = { from: number; to: number; kind: 'sc' | 'vsc' | 'red' };

/** The bands clipped to the visible x-range; bands outside it, touching only its edge or empty are dropped. */
export function clipBands(bands: PhaseBand[], [lo, hi]: [number, number]): PhaseBand[] {
  const out: PhaseBand[] = [];
  for (const b of bands) {
    const from = Math.max(b.from, lo);
    const to = Math.min(b.to, hi);
    if (to > from) out.push({ from, to, kind: b.kind });
  }
  return out;
}
