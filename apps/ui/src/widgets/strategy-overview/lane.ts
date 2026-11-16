// The lap lane of one Field plans row (SP4.3d spec §6.4, V06; mockup gen.mjs `laneSvg`): one cell a lap, laps 1…flag.
// It places the topic's laps (stints, a rival's window, our plans' stops); it judges nothing (C65, C43).
import type { CarId, NoiseCompound, OverviewRow, Policy, StrategyOverview } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import type { WidgetSize } from '../../kit/types.ts';
import type { Role } from '../../theme/index.ts';
import { FAINT_ROLE, solidRole } from './emphasis.ts';
import type { FieldRow } from './rows.ts';

/** One block of the lane, both laps inclusive; `letter` the compound's mark letter, '' for none. */
export type LaneBlock = { fromLap: number; toLap: number; letter: string; style: 'solid' | 'outline' | 'faint'; role: Role };
/** One lap of a rival's window, shaded with `opacity`. */
export type LaneShade = { lap: number; opacity: number };
/** The lane: blocks in lap order, the window's shades, plan B's stop laps after now. */
export type Lane = { blocks: LaneBlock[]; shades: LaneShade[]; marks: number[] };
export type LaneContext = { now: number; flag: number; own: boolean };
export type LapWindow = { lowLap: number; midLap: number; highLap: number };

/** The shade's faintest and darkest opacity (gen.mjs: 0.15 + 0.55 · weight). */
const SHADE_FLOOR = 0.15;
const SHADE_SPAN = 0.55;

/** A lap's shade in its window: darkest at `midLap`, fading linearly towards either end, always above 0. */
export function windowShade(lap: number, w: LapWindow): number {
  const weight = 1 - Math.abs(lap - w.midLap) / (Math.max(w.midLap - w.lowLap, w.highLap - w.midLap) + 1);
  return SHADE_FLOOR + SHADE_SPAN * weight;
}

const letterOf = (c: NoiseCompound): string => COMPOUND_MARK[c].letter;

/** The likeliest next compound's letter (the largest chance), '' while the odds are unknown or empty. */
function likeliestLetter(row: OverviewRow): string {
  if (!row.nextCompound.known) return '';
  let best: [NoiseCompound, number] | undefined;
  for (const [c, p] of Object.entries(row.nextCompound.value) as [NoiseCompound, number][]) if (best === undefined || p > best[1]) best = [c, p];
  return best === undefined ? '' : letterOf(best[0]);
}

/** Plan A's stints after now, outlined: the current set runs on (no letter) to the first stop, then one per stop. */
function planBlocks(a: Policy, now: number, flag: number): LaneBlock[] {
  const out: LaneBlock[] = [];
  let from = now + 1;
  let letter = '';
  for (const stop of a.stops.filter((s) => s.lap > now)) {
    out.push({ fromLap: from, toLap: stop.lap, letter, style: 'outline', role: 'ownCar' });
    from = stop.lap + 1;
    letter = letterOf(stop.compound);
  }
  out.push({ fromLap: from, toLap: flag, letter, style: 'outline', role: 'ownCar' });
  return out;
}

/** The lane of one row at the lap `now` of a race of `flag` laps. */
export function laneOf(row: OverviewRow, ctx: LaneContext): Lane {
  const { now, flag, own } = ctx;
  const blocks: LaneBlock[] = [];
  const shades: LaneShade[] = [];
  let marks: number[] = [];
  const solid = solidRole(own);
  for (const s of row.pastStints) blocks.push({ fromLap: s.fromLap, toLap: s.toLap, letter: COMPOUND_MARK[s.compound].letter, style: 'solid', role: solid });
  const currentFrom = (row.pastStints.at(-1)?.toLap ?? 0) + 1;
  blocks.push({ fromLap: currentFrom, toLap: now, letter: row.compound.known ? COMPOUND_MARK[row.compound.value].letter : '', style: 'solid', role: solid });
  const faint = (fromLap: number, toLap: number, letter: string): void => {
    blocks.push({ fromLap, toLap, letter, style: 'faint', role: FAINT_ROLE });
  };
  if (own) {
    if (row.plan?.a) blocks.push(...planBlocks(row.plan.a, now, flag));
    if (row.plan?.b) marks = row.plan.b.stops.filter((s) => s.lap > now).map((s) => s.lap);
  } else if (row.window.known) {
    const w = row.window.value;
    if (w.lowLap > now + 1) faint(now + 1, w.lowLap - 1, '');
    for (let lap = Math.max(w.lowLap, now + 1); lap <= w.highLap; lap++) shades.push({ lap, opacity: windowShade(lap, w) });
    faint(Math.max(w.highLap, now) + 1, flag, likeliestLetter(row));
  } else {
    faint(now + 1, flag, '');
  }
  return { blocks: blocks.filter((b) => b.fromLap <= b.toLap), shades, marks };
}

/** The laps the axis names: 1 and every tenth lap up to the flag (gen.mjs `axis`). */
const AXIS_STEP = 10;

/** The lap axis over the lane as text parts of one cell a lap: a label at lap 1 and every tenth lap, each padded to the next. */
export function axisParts(flag: number): { text: string; width: number }[] {
  const laps = [1];
  for (let lap = AXIS_STEP; lap <= flag; lap += AXIS_STEP) laps.push(lap);
  return laps.map((lap, i) => ({ text: String(lap), width: (laps[i + 1] ?? flag + 1) - lap }));
}

/** One character cell in px. */
export type Cell = { w: number; h: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** The lane in px: one cell a lap, blocks inset from the cell's top and bottom (gen.mjs `laneSvg`). */
export type LaneScene = {
  width: number;
  height: number;
  blocks: (LaneBlock & { rect: Rect; letterX: number; letterY: number })[];
  shades: (LaneShade & { rect: Rect })[];
  /** Plan B's stops: a small triangle at the end of the stop's lap, on the line under our plan. */
  marks: { lap: number; path: string }[];
  /** The line under our plan, from now to the flag, while plan B has stops ahead. */
  planLine: { x1: number; x2: number; y: number } | undefined;
  /** The line at now: at the start of the lap after now. */
  nowX: number;
};

/** The block inset from the cell's top and bottom, the letter's inset from the block's left and bottom, the mark's half width and height. */
const INSET = 3;
const LETTER_PAD = 2;
const MARK_HALF = 3;
const MARK_HEIGHT = 5;

/** Places a lane in px for cells of `cell`. */
export function laneScene(lane: Lane, ctx: { now: number; flag: number }, cell: Cell): LaneScene {
  const x = (lap: number): number => (lap - 1) * cell.w;
  const y0 = INSET;
  const y1 = cell.h - INSET;
  const rect = (fromLap: number, toLap: number): Rect => ({ x: x(fromLap) + 0.5, y: y0, width: Math.max(0, (toLap - fromLap + 1) * cell.w - 1), height: Math.max(0, y1 - y0) });
  return {
    width: ctx.flag * cell.w,
    height: cell.h,
    blocks: lane.blocks.map((b) => ({ ...b, rect: rect(b.fromLap, b.toLap), letterX: x(b.fromLap) + INSET, letterY: y1 - LETTER_PAD })),
    shades: lane.shades.map((s) => ({ ...s, rect: rect(s.lap, s.lap) })),
    marks: lane.marks.map((lap) => {
      const mx = x(lap + 1);
      return { lap, path: `M${mx - MARK_HALF} ${cell.h} L${mx} ${cell.h - MARK_HEIGHT} L${mx + MARK_HALF} ${cell.h} Z` };
    }),
    planLine: lane.marks.length === 0 ? undefined : { x1: x(ctx.now + 1), x2: x(ctx.flag + 1), y: cell.h - 1 },
    nowX: x(ctx.now + 1),
  };
}

/** The panel's cell in px: px width per column, px height per row; a zero count counts as one (as `pit-window-strip`). */
export const cellOf = (size: { cols: number; rows: number; px: { width: number; height: number } }): Cell => ({
  w: size.px.width / Math.max(1, size.cols),
  h: size.px.height / Math.max(1, size.rows),
});

/**
 * Every topic row's lane scene, by car id, at the panel's cell; our rows (the rows.ts kind `own` or `mate`) drawn as ours.
 * Empty in compact, while the lap now or the flag is unknown, or with no laps.
 */
export function lanesOf(input: {
  overview: StrategyOverview;
  rows: readonly FieldRow[];
  now: number | undefined;
  flag: number | undefined;
  size: WidgetSize;
}): Map<CarId, LaneScene> {
  const { overview, rows, now, flag, size } = input;
  const out = new Map<CarId, LaneScene>();
  if (size.mode !== 'full' || now === undefined || flag === undefined || flag <= 0) return out;
  const kinds = new Map(rows.map((r) => [r.carId, r.kind]));
  const cell = cellOf(size);
  for (const r of overview.rows) {
    const kind = kinds.get(r.carId);
    const own = kind === 'own' || kind === 'mate';
    out.set(r.carId, laneScene(laneOf(r, { now, flag, own }), { now, flag }, cell));
  }
  return out;
}
