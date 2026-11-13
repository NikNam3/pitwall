// The strategy chart's geometry (SP4.3b spec §10; mockup strategy-table-b.html, gen.mjs `chartSvgB`; Q10 B): every
// policy's finishing-place distribution (`positionPmf`, the topic's) as one line over P1 … Pn, one shared chance axis.
// It places and colours what `strategy` published; StrategyChart.svelte draws it with theme roles only (C65, C68).
import type { McRow } from '@pitwall/domain';
import { formatPosition, formatShare } from '../../kit/values/format.ts';
import { DEFAULT_THEME, type Role } from '../../theme/index.ts';

/** Room inside the box kept free for the axis labels (px). */
export type Pad = { l: number; r: number; t: number; b: number };
/** The chart's drawing box in px, with the room its labels keep (none by default). */
export type Box = { width: number; height: number; pad?: Pad };
/** One policy's line: its points (P1 … Pn), role, width, dotted, whether its points are drawn. */
export type Line = { points: [number, number][]; role: Role; widthPx: number; dotted: boolean; dots: boolean };
/** The faint vertical at our place now, and the E[pos] tick of the highlighted row (null without a highlight). */
export type Marks = { now: { x: number; role: Role }; tick: { x: number; role: Role } | null };
export type ChartState = { highlight: number | null };
/** A horizontal grid line with its chance label, and a place label under the axis. */
export type Axes = { grid: { y: number; label: string }[]; places: { x: number; label: string }[]; x0: number; x1: number; y0: number; y1: number };

const NO_PAD: Pad = { l: 0, r: 0, t: 0, b: 0 };
/** The chance axis' top rounds up to the next 5 % (gen.mjs `yMax`); its grid lines every 10 %. */
const Y_STEP = 0.05;
const GRID_STEP = 0.1;
/** The places labelled under the axis (the mockup's P1, P5, P10, P15, P20). */
const PLACE_LABELS = [1, 5, 10, 15, 20];

type Scale = { x: (place: number) => number; y: (chance: number) => number; places: number; yMax: number; pad: Pad };

function scaleOf(rows: readonly McRow[], box: Box): Scale {
  const pad = box.pad ?? NO_PAD;
  const places = Math.max(1, ...rows.map((r) => r.positionPmf.length));
  const top = Math.max(0, ...rows.flatMap((r) => r.positionPmf));
  const yMax = Math.max(Y_STEP, Math.ceil(top / Y_STEP - 1e-9) * Y_STEP);
  const w = Math.max(0, box.width - pad.l - pad.r);
  const h = Math.max(0, box.height - pad.t - pad.b);
  return {
    x: (place) => pad.l + (places > 1 ? (w * (place - 1)) / (places - 1) : w / 2),
    y: (chance) => pad.t + h - (h * Math.min(chance, yMax)) / yMax,
    places,
    yMax,
    pad,
  };
}

const { lineWidth, ownCarLineWidth } = DEFAULT_THEME.chart;

function lookOf(rows: readonly McRow[], i: number, h: number | null): Omit<Line, 'points'> {
  const row = rows[i];
  const anyCommitted = rows.some((r) => r.committed);
  if (h === i) return { role: 'ownCar', widthPx: ownCarLineWidth, dotted: anyCommitted, dots: true };
  if (row?.committed === true) return { role: 'ownCar', widthPx: lineWidth, dotted: false, dots: false };
  if (h === null) return { role: 'textDim', widthPx: lineWidth, dotted: false, dots: false };
  const sameGroup = rows[h]?.tie === true && row?.tie === true;
  return { role: sameGroup ? 'textDim' : 'textFaint', widthPx: lineWidth, dotted: false, dots: false };
}

export function chartLines(rows: readonly McRow[], state: ChartState, box: Box): Line[] {
  const s = scaleOf(rows, box);
  return rows.map((row, i) => ({
    points: row.positionPmf.map((p, k): [number, number] => [s.x(k + 1), s.y(p)]),
    ...lookOf(rows, i, state.highlight),
  }));
}

/**
 * The rows whose lines the chart draws (gen.mjs `prepRows`; R63): every row without a limit, else the `limit` best-ranked
 * (rows come ranked) plus the committed row when it ranks lower (Q10 B: the committed line is always worth seeing).
 */
export function drawnRows(rows: readonly McRow[], limit?: number): number[] {
  return rows.flatMap((r, i) => (limit === undefined || i < limit || r.committed ? [i] : []));
}

export function chartMarks(rows: readonly McRow[], state: ChartState, box: Box, currentPosition: number): Marks {
  const s = scaleOf(rows, box);
  const hi = state.highlight === null ? undefined : rows[state.highlight];
  return {
    now: { x: s.x(currentPosition), role: 'textFaint' },
    tick: hi === undefined ? null : { x: s.x(hi.ePos), role: 'ownCar' },
  };
}

/** The grid lines with their chance labels (`10%`) and the place labels (`P5`), inside the box's pad. */
export function chartAxes(rows: readonly McRow[], box: Box): Axes {
  const s = scaleOf(rows, box);
  const steps = Math.floor(s.yMax / GRID_STEP + 1e-9);
  return {
    grid: Array.from({ length: steps + 1 }, (_, k) => ({ y: s.y(k * GRID_STEP), label: formatShare(k * GRID_STEP) })),
    places: PLACE_LABELS.filter((p) => p <= s.places).map((p) => ({ x: s.x(p), label: formatPosition(p) })),
    x0: s.x(1),
    x1: s.x(s.places),
    y0: s.y(s.yMax),
    y1: s.y(0),
  };
}
