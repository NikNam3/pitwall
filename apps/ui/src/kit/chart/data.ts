/** Pure helpers of the chart: aligning series for uPlot and picking the visible x-range. */

export type ChartSeries = {
  label: string;
  points: Array<[x: number, y: number]>;
  /** False dims the series (its data is stale). */
  fresh?: boolean | undefined;
  /** A car series passes `carColour`'s result; own cars draw thicker. */
  colour?: { colour: string; dashed: boolean; ownCar: boolean } | undefined;
};

/** Character cells of width that each data point of the x axis gets: a wider chart shows more points. */
export const CELLS_PER_POINT = 2;

/** uPlot data: the sorted union of all x values, then each series' y at those x (null where it has none). */
export function buildData(series: ChartSeries[]): Array<Array<number | null>> {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
  return [xs, ...series.map((s) => {
    const byX = new Map(s.points);
    return xs.map((x) => byX.get(x) ?? null);
  })];
}

/** The x-range showing the newest `cols / CELLS_PER_POINT` points: more width, more history. */
export function visibleXRange(xs: number[], cols: number, min: number, max: number): [number, number] {
  const n = Math.max(2, Math.floor(cols / CELLS_PER_POINT));
  if (xs.length <= n) return [min, max];
  return [xs[xs.length - n] ?? min, max];
}
