/** Pure helpers of the chart: aligning series for uPlot, picking the visible ranges, and the marks' and bands' geometry. */
import type { Role } from '../../theme/index.ts';

export type ChartSeries = {
  label: string;
  points: Array<[x: number, y: number]>;
  /** False dims the series (its data is stale). */
  fresh?: boolean | undefined;
  /** A car series passes `carColour`'s result; own cars draw thicker. */
  colour?: { colour: string; dashed: boolean; ownCar: boolean } | undefined;
  /** True when the last point is live (a value now, not a settled one): the segment to it is drawn dotted. */
  liveEnd?: boolean | undefined;
  /** The ±sd band around the line (usually the line's own points with their sd), painted in the line's colour. */
  band?: readonly BandPoint[] | undefined;
};

/** One point of a series' band: the band runs from `y - sd` to `y + sd` at `x`. */
export type BandPoint = { x: number; y: number; sd: number };

/**
 * A point mark, drawn over the lines and no uPlot series: a filled `dot`, a solid `ring` or a `dottedRing`, in its role.
 * A `pinned` mark never widens the y range; off-scale it is drawn at the plot's edge.
 */
export type ChartMark = { x: number; y: number; shape: 'dot' | 'ring' | 'dottedRing'; role: Role; pinned?: boolean | undefined };

/** The x kinds: laps and session time follow the width; a tyre age shows the whole stint. */
export type XKind = 'lap' | 'sessionTime' | 'tyreAge';

/** A line uPlot draws: `of` is the index of its series; `live` marks the dotted segment to that series' live end. */
export type PlotLine = { of: number; live: boolean; points: ChartSeries['points'] };

/**
 * The lines uPlot draws: every series in order, without its live point, then every series' live line in series order:
 * the segment from its last settled point to its live point, or no points when it has no live end. The lines depend
 * only on the number of series, so a live end that comes or goes changes the data, never the plot.
 */
export function plotLines(series: ChartSeries[]): PlotLine[] {
  const settled = series.map((s, of) => ({ of, live: false, points: s.liveEnd === true ? s.points.slice(0, -1) : s.points }));
  const live = series.map((s, of) => ({ of, live: true, points: s.liveEnd === true ? s.points.slice(-2) : [] }));
  return [...settled, ...live];
}

/**
 * uPlot data: the sorted union of all x values (and of `extraXs`, the marks' x, so the plot has data where only marks
 * are), then each series' y at those x (null where it has none).
 */
export function buildData(series: ReadonlyArray<Pick<ChartSeries, 'points'>>, extraXs: readonly number[] = []): Array<Array<number | null>> {
  const xs = [...new Set([...series.flatMap((s) => s.points.map((p) => p[0])), ...extraXs])].sort((a, b) => a - b);
  return [xs, ...series.map((s) => {
    const byX = new Map(s.points);
    return xs.map((x) => byX.get(x) ?? null);
  })];
}

/**
 * The visible x-range: ends at the newest x and spans at most `cols` cells of `xPerCell[kind]` x units each, so width
 * shows history. With less history than that it starts at the first data point (never at negative laps); a single
 * point starts at max(0, end - span), or spans [end, end + span] when that would be degenerate. A tyre-age axis shows
 * the whole stint whatever the width: from 0 (a new tyre) to one lap past the oldest age; no x is [0, 1].
 */
export function visibleXRange(
  xs: number[],
  cols: number,
  kind: XKind,
  xPerCell: { lap: number; sessionTime: number },
): [number, number] {
  if (kind === 'tyreAge') return [0, xs.reduce((a, b) => Math.max(a, b + 1), 1)];
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

/**
 * The y values the plot must show: every series point's y, every band point's y - sd and y + sd, every mark's y that is
 * not pinned. A pinned mark never widens it; only when nothing else has a y is it the pinned marks' extent. Nothing at
 * all is `undefined`.
 */
export function yExtent(series: readonly ChartSeries[], marks: readonly ChartMark[]): [number, number] | undefined {
  const ys = [
    ...series.flatMap((s) => [...s.points.map((p) => p[1]), ...(s.band ?? []).flatMap((b) => [b.y - b.sd, b.y + b.sd])]),
    ...marks.filter((m) => m.pinned !== true).map((m) => m.y),
  ];
  const shown = ys.length > 0 ? ys : marks.map((m) => m.y);
  if (shown.length === 0) return undefined;
  return [shown.reduce((a, b) => Math.min(a, b)), shown.reduce((a, b) => Math.max(a, b))];
}

/**
 * The band as one polygon: its upper edge (y + sd) in x order, then its lower edge (y - sd) back. Fewer than two points
 * have no area and give `[]`.
 */
export function bandOutline(band: readonly BandPoint[]): Array<[number, number]> {
  if (band.length < 2) return [];
  const sorted = [...band].sort((a, b) => a.x - b.x);
  const upper = sorted.map((b): [number, number] => [b.x, b.y + b.sd]);
  const lower = sorted.map((b): [number, number] => [b.x, b.y - b.sd]).reverse();
  return [...upper, ...lower];
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
