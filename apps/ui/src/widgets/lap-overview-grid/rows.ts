// The lap overview's rows (spec 4; C65): the topic's laps laid out and formatted, nothing computed. Heat, best and status
// are the analysis's (C43); they pass through for the emphasis.
import type { Known, LapOverviewLap, LapStatus, Ratio } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { formatLapNumber, formatLapRange, formatMinutesTenths } from '../../kit/values/format.ts';
import * as text from './text.ts';

/** Laps to a full row; a row starts at L01, L11, L21, … and at a stint's first lap. */
const LAPS_PER_ROW = 10;
/** Cells of the compact line before the first lap. */
const COMPACT_LEAD = 1;

export type LapCell = {
  lapNumber: number;
  time: string;
  mark: string;
  heat: Known<Ratio>;
  best: LapOverviewLap['best'];
  status: LapStatus;
  strip: string;
};

export type GridLine =
  | { kind: 'stint'; text: string }
  | { kind: 'laps'; label: string; cells: LapCell[] }
  | { kind: 'strip'; cells: LapCell[] };

const lapCell = (l: LapOverviewLap): LapCell => ({
  lapNumber: l.lapNumber,
  time: formatMinutesTenths(l.lapTimeMs),
  mark: text.lapMark[l.kind],
  heat: l.heat,
  best: l.best,
  status: l.status,
  strip: text.statusStrip[l.status],
});

/** Groups the laps into rows: a new row on a new stint or at a lap number ending in 1. */
function rows(laps: readonly LapOverviewLap[]): LapOverviewLap[][] {
  const out: LapOverviewLap[][] = [];
  let prev: LapOverviewLap | undefined;
  for (const l of laps) {
    const row = out.at(-1);
    if (row === undefined || prev?.stint !== l.stint || l.lapNumber % LAPS_PER_ROW === 1) out.push([l]);
    else row.push(l);
    prev = l;
  }
  return out;
}

/** The full grid's lines top to bottom: per stint its title, then its rows, each with a strip line under it when a lap
 *  of it is not green. With `maxRows`, strip lines go first, the oldest first; when the lap lines alone still do not
 *  fit, the oldest lines go. */
export function gridLines(laps: readonly LapOverviewLap[], maxRows?: number): GridLine[] {
  const lines: GridLine[] = [];
  let stint: number | undefined;
  for (const row of rows(laps)) {
    const first = row[0];
    if (first === undefined) continue;
    if (first.stint !== stint) {
      stint = first.stint;
      lines.push({ kind: 'stint', text: text.stintTitle(first.stint, COMPOUND_MARK[first.compound].letter) });
    }
    const cells = row.map(lapCell);
    lines.push({ kind: 'laps', label: formatLapNumber(first.lapNumber, 2), cells });
    if (cells.some((c) => c.status !== 'green')) lines.push({ kind: 'strip', cells });
  }
  if (maxRows === undefined) return lines;
  let fitted = lines;
  while (fitted.length > maxRows) {
    const oldestStrip = fitted.findIndex((l) => l.kind === 'strip');
    if (oldestStrip < 0) break;
    fitted = fitted.filter((_, i) => i !== oldestStrip);
  }
  return fitted.slice(Math.max(0, fitted.length - maxRows));
}

export type CompactCell = {
  lapNumber: number;
  block: string;
  heat: Known<Ratio>;
  best: LapOverviewLap['best'];
  status: LapStatus;
  strip: string;
};

const block = (heat: Known<Ratio>): string =>
  heat.known ? (text.heatBlocks[Math.round(heat.value * (text.heatBlocks.length - 1))] ?? text.noHeatBlock) : text.noHeatBlock;

/** The compact line: one cell per lap for the newest laps that fit `cols` after the lead cell, oldest first, labelled
 *  with the newest lap's compound letter and the shown laps' range. */
export function compactLine(laps: readonly LapOverviewLap[], cols: number): { label: string; cells: CompactCell[] } {
  const shown = laps.slice(Math.max(0, laps.length - Math.max(0, cols - COMPACT_LEAD)));
  const first = shown[0];
  const last = shown.at(-1);
  if (first === undefined || last === undefined) return { label: '', cells: [] };
  return {
    label: `${COMPOUND_MARK[last.compound].letter}${text.compactLabelGap}${formatLapRange(first.lapNumber, last.lapNumber)}`,
    cells: shown.map((l) => ({
      lapNumber: l.lapNumber,
      block: block(l.heat),
      heat: l.heat,
      best: l.best,
      status: l.status,
      strip: l.status === 'green' ? '' : text.compactStrip,
    })),
  };
}
