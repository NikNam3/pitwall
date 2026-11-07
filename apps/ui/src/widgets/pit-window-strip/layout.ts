// The pit-window strip's chart layout (SP4.2 spec §4 "Pit-window label layout"; the rules of
// docs/design/2026-11-07-sp4.2/gen.mjs `layoutRow` and `chartSvg`). It places the topic's laps on the race's lap axis,
// in px of a panel `cols × cell.w` wide; it computes no value (C65). Rows: 0 the fitted set, one per visible set, the axis.
//  - labels sit on top of lines (each on a knockout in its row's background) and never on a bar;
//  - a window's two laps go left and right of its band, else together on the right, else on the left, else together
//    inside the band, on a knockout that cuts the band (the last resort: a window's laps are never dropped);
//  - the fitted set's last lap goes right of its bar end, else left of its start, else inside its end;
//  - the axis places now, then the flag, then a faint lap every 10, dropping a label within one cell of a placed one;
//  - the chart keeps room right of the flag for one lap label.
import type { PitWindow, UnknownReason } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { formatLapNumber } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { bandRole, windowEmphasis } from './emphasis.ts';
import { fittedEmphasis, hasWindow, setState, visibleSets, windowText } from './rows.ts';

type Box = { l: number; r: number };
export type Cell = { w: number; h: number };

/** A rectangle in px. */
export type Rect = { x: number; y: number; width: number; height: number };
/** A solid bar, or a hollow one (the rest of the fitted set's life), in its row; `rect` as drawn (a hollow one inset
 *  half a px, so its 1 px outline stays inside `box`). */
export type Bar = { row: number; box: Box; rect: Rect; role: Role; hollow: boolean };
/** A thin line: the flag, now, a set's life and its end tick. */
export type Line = { x1: number; y1: number; x2: number; y2: number; role: Role };
export type Label = {
  row: number;
  x: number;
  /** The row's middle: the text's central baseline. */
  y: number;
  anchor: 'start' | 'middle' | 'end';
  text: string;
  role: Role;
  bold: boolean;
  /** The label's extent in its row: `[...text].length × cell.w` wide, at `x` by its anchor. */
  box: Box;
};
/** A label's knockout: the row's background behind it, breaking the lines there. */
export type Knockout = Rect & { role: Role };
/** A compound letter at the left of its row. */
export type Letter = { x: number; y: number; text: string };

export type StripLayout = {
  bars: Bar[];
  lines: Line[];
  labels: Label[];
  /** One per label, in the same order. */
  knockouts: Knockout[];
  letters: Letter[];
  /** The set rows with the band background (every other one, from the first). */
  bands: Rect[];
  width: number;
  height: number;
  /** While the fitted set's last lap is unknown: where its reason's mark goes (top left). */
  unknown?: { x: number; y: number; reason: UnknownReason };
};

export type StripInput = { cols: number; window: PitWindow; showOther: boolean };

/** The panel's cell in px, from its size. */
export const cellOf = (size: { cols: number; rows: number; px: { width: number; height: number } }): Cell => ({
  w: size.px.width / Math.max(1, size.cols),
  h: size.px.height / Math.max(1, size.rows),
});

/** Cells left of the chart: the compound letter. */
const LETTER_COLS = 3;
/** Cells of the lap label kept right of the flag. */
const FLAG_ROOM_COLS = 4;
/** Px between a label and its bar. */
const PAD = 4;
/** Px kept free at the panel's right edge and the chart's top. */
const EDGE = 2;
/** Height of a bar in px. */
const BAR_PX = 6;
/** Half the height of a life line's end tick in px. */
const TICK_PX = 4;
/** Px a knockout reaches past its label sideways, and stays inside its row vertically. */
const KNOCKOUT_PX = 2;

type Placed = Box & { bar: boolean };
/** A label before it is placed: no box, no y (both follow from its row and anchor). */
type Candidate = Omit<Label, 'box' | 'y'>;
type Placing = Omit<Label, 'y'>;

/** The box of a label by its anchor. */
function boxOf(c: Candidate, cw: number): Box {
  const w = [...c.text].length * cw;
  if (c.anchor === 'end') return { l: c.x - w, r: c.x };
  if (c.anchor === 'middle') return { l: c.x - w / 2, r: c.x + w / 2 };
  return { l: c.x, r: c.x + w };
}

/** A label centred on `mid`, kept inside `[lo, hi]`. */
function clampedMiddle(base: Omit<Candidate, 'x' | 'anchor'>, mid: number, lo: number, hi: number, cw: number): Candidate {
  const half = ([...base.text].length * cw) / 2;
  return { ...base, anchor: 'middle', x: Math.min(hi - half, Math.max(lo + half, mid)) };
}

/** The strip's bars, lines and labels in px. */
export function layoutStrip(input: StripInput, cell: Cell): StripLayout {
  const { cols, window: w, showOther } = input;
  const cw = cell.w;
  const width = cols * cw;
  const sets = visibleSets(w, showOther);
  const axisRow = sets.length + 1;
  const lo = (LETTER_COLS + 0.5) * cw;
  const hi = width - EDGE;
  const x0 = (LETTER_COLS + 1) * cw;
  const x1 = width - FLAG_ROOM_COLS * cw - PAD - EDGE;
  const { flag, currentLap: now } = w;
  const xe = (lap: number): number => x0 + ((x1 - x0) * lap) / flag; // the end of lap `lap`
  const xs = (lap: number): number => xe(lap - 1); // its start
  const yMid = (row: number): number => row * cell.h + cell.h / 2;

  const bars: Bar[] = [];
  const lines: Line[] = [];
  const placing: Placing[] = [];
  const letters: Letter[] = [];
  /** The boxes placed in each row: its bars' reach and its labels. */
  const placedRows = new Map<number, Placed[]>();
  const placed = (row: number): Placed[] => {
    const boxes = placedRows.get(row) ?? [];
    placedRows.set(row, boxes);
    return boxes;
  };

  const line = (xa: number, ya: number, xb: number, yb: number, role: Role): void => {
    if (xb > xa || yb > ya) lines.push({ x1: xa, y1: ya, x2: xb, y2: yb, role });
  };
  const bar = (row: number, l: number, r: number, role: Role, hollow = false): void => {
    if (r > l) bars.push({ row, box: { l, r }, rect: barRect(row, { l, r }, hollow), role, hollow });
  };
  const barRect = (row: number, b: Box, hollow: boolean): Rect => {
    const inset = hollow ? 0.5 : 0;
    return { x: b.l + inset, y: yMid(row) - BAR_PX / 2 + inset, width: Math.max(0, b.r - b.l - 2 * inset), height: BAR_PX - 2 * inset };
  };
  /** Places the first group of candidates that fits inside the panel clear of its row's boxes; false when none does. */
  const placeFirst = (row: number, groups: Candidate[][]): boolean => {
    const inRow = placed(row);
    for (const group of groups) {
      const boxed = group.map((c) => ({ ...c, box: boxOf(c, cw) }));
      const fits = boxed.every(({ box: b }) => b.l >= lo && b.r <= hi && inRow.every((p) => {
        const gap = p.bar ? PAD : cw;
        return b.r + gap <= p.l || b.l >= p.r + gap;
      }));
      if (fits) {
        inRow.push(...boxed.map((b) => ({ ...b.box, bar: false })));
        placing.push(...boxed);
        return true;
      }
    }
    return false;
  };
  /** The last resort: a label inside its row's bars; its knockout cuts every bar it would touch. */
  const placeInside = (row: number, c: Candidate): void => {
    const box = boxOf(c, cw);
    placing.push({ ...c, box });
    const cut = { l: box.l - KNOCKOUT_PX, r: box.r + KNOCKOUT_PX };
    const kept = bars.flatMap((b): Bar[] => {
      if (b.row !== row || b.box.r <= cut.l || b.box.l >= cut.r) return [b];
      const part = (box: Box): Bar => ({ ...b, box, rect: barRect(row, box, b.hollow) });
      return [...(b.box.l < cut.l ? [part({ l: b.box.l, r: cut.l })] : []), ...(b.box.r > cut.r ? [part({ l: cut.r, r: b.box.r })] : [])];
    });
    bars.splice(0, bars.length, ...kept);
  };

  const chartBottom = axisRow * cell.h;
  line(xe(flag), EDGE, xe(flag), chartBottom, 'textDim');

  // ---- the fitted set: done laps solid, the rest of its life hollow, past its life amber, its last lap at the end
  letters.push({ x: cw, y: yMid(0), text: COMPOUND_MARK[w.stint.compound].letter });
  const from = w.stint.fromLap;
  const latest = w.stint.latest;
  let unknown: StripLayout['unknown'];
  if (!latest.known) {
    bar(0, xs(from), xe(now), 'text');
    unknown = { x: Math.min(xe(now) + PAD, x1), y: 0, reason: latest.reason };
  } else {
    const last = latest.value;
    // no stop to plan (the analysis caps the latest stop lap at flag − 1): the bar runs to the flag, no last lap
    const noStop = w.sets.length === 0 && w.window.known && w.window.value === 'none' && last === flag - 1;
    const end = noStop ? flag : last;
    bar(0, xs(from), xe(Math.min(now, end)), 'text');
    if (now < end) bar(0, xe(now), xe(end), 'textDim', true);
    if (now > end) bar(0, xe(end), xe(now), 'warning');
    const barEnd = Math.max(xe(end), xe(now));
    placed(0).push({ l: xs(from), r: barEnd, bar: true });
    if (!noStop) {
      const base = { row: 0, text: formatLapNumber(last, 2), ...fittedEmphasis(w) };
      const ok = placeFirst(0, [[{ ...base, x: barEnd + PAD, anchor: 'start' }], [{ ...base, x: xs(from) - PAD, anchor: 'end' }]]);
      if (!ok) placeInside(0, { ...base, x: Math.max(lo + [...base.text].length * cw, barEnd - PAD), anchor: 'end' });
    }
  }

  // ---- one row per visible set: its window as a band, its laps beside it, then its life as a thin line
  sets.forEach((set, i) => {
    const row = i + 1;
    const y = yMid(row);
    letters.push({ x: cw, y, text: COMPOUND_MARK[set.compound].letter });
    if (!latest.known) return;
    const last = latest.value;
    if (!hasWindow(set) || !set.earliest.known) {
      if (set.lifeEnd.known) {
        const lifeEnd = Math.min(set.lifeEnd.value, flag);
        line(xe(last), y, xe(lifeEnd), y, 'textFaint');
        line(xe(lifeEnd), y - TICK_PX, xe(lifeEnd), y + TICK_PX, 'textFaint');
      }
      return;
    }
    const earliest = set.earliest.value;
    const state = setState(w, set);
    bar(row, xs(Math.max(earliest, now + 1)), xe(last), bandRole(state));
    line(xe(last), y, xe(flag), y, 'textFaint');
    const bandL = xs(earliest);
    const bandR = xe(last);
    placed(row).push({ l: bandL, r: bandR, bar: true });
    const base = { row, ...windowEmphasis(state) };
    const both = windowText(earliest, last);
    const groups: Candidate[][] = earliest === last
      ? [[{ ...base, text: both, x: bandR + PAD, anchor: 'start' }], [{ ...base, text: both, x: bandL - PAD, anchor: 'end' }]]
      : [
          [{ ...base, text: formatLapNumber(earliest, 2), x: bandL - PAD, anchor: 'end' }, { ...base, text: formatLapNumber(last, 2), x: bandR + PAD, anchor: 'start' }],
          [{ ...base, text: both, x: bandR + PAD, anchor: 'start' }],
          [{ ...base, text: both, x: bandL - PAD, anchor: 'end' }],
        ];
    if (!placeFirst(row, groups)) placeInside(row, clampedMiddle({ ...base, text: both }, (bandL + bandR) / 2, lo, hi, cw));
  });

  line(xe(now), EDGE, xe(now), chartBottom, 'ownCar');

  // ---- the axis: now, the flag, a faint lap every 10
  placeFirst(axisRow, [[clampedMiddle({ row: axisRow, text: formatLapNumber(now, 2), role: 'ownCar', bold: true }, xe(now), lo, hi, cw)]]);
  placeFirst(axisRow, [[clampedMiddle({ row: axisRow, text: formatLapNumber(flag, 2), role: 'textDim', bold: false }, xe(flag), lo, hi, cw)]]);
  for (let lap = 10; lap < flag; lap += 10) {
    placeFirst(axisRow, [[{ row: axisRow, text: formatLapNumber(lap, 2), role: 'textFaint', bold: false, x: (xs(lap) + xe(lap)) / 2, anchor: 'middle' }]]);
  }

  const banded = (row: number): boolean => row >= 1 && row < axisRow && (row - 1) % 2 === 0;
  const labels: Label[] = placing.map((l) => ({ ...l, y: yMid(l.row) }));
  const knockouts: Knockout[] = labels.map((l) => ({
    x: l.box.l - KNOCKOUT_PX,
    y: l.row * cell.h + KNOCKOUT_PX,
    width: l.box.r - l.box.l + 2 * KNOCKOUT_PX,
    height: cell.h - 2 * KNOCKOUT_PX,
    role: banded(l.row) ? 'bgRowBand' : 'bgPanel',
  }));
  const bands: Rect[] = sets.flatMap((_, i) => (banded(i + 1) ? [{ x: 0, y: (i + 1) * cell.h, width, height: cell.h }] : []));
  return {
    bars, lines, labels, knockouts, letters, bands, width, height: (axisRow + 1) * cell.h,
    ...(unknown === undefined ? {} : { unknown }),
  };
}
