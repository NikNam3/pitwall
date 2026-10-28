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

/** The visible x-range: ends at the newest x and spans `cols` cells of `xPerCell[kind]` x units each, so width shows history. */
export function visibleXRange(
  xs: number[],
  cols: number,
  kind: 'lap' | 'sessionTime',
  xPerCell: { lap: number; sessionTime: number },
): [number, number] {
  const span = cols * xPerCell[kind];
  if (xs.length === 0) return [0, span];
  const end = xs.reduce((a, b) => Math.max(a, b));
  return [end - span, end];
}
