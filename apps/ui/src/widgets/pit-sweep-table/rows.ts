// The pit-sweep table's rows as text (C65): every number is `pit-sweep`'s, formatted here; the rows shown are the ones
// that fit, centred on the window `pit-sweep` marks. Nothing here judges (C43).
import type { Known, PitSweep, PitSweepRow, UnknownReason } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { formatCount, formatExpectedPlace, formatLapNumber, formatPosition, formatShare } from '../../kit/values/format.ts';
import * as text from './text.ts';

/** A cell: its text, or the reason of an unknown value (the kit's mark). */
export type Cell = { text: string; reason?: UnknownReason | undefined };

/** One stop lap's cells. */
export type SweepLine = {
  lap: string;
  rej: Cell;
  trf: Cell;
  ePos: string;
  pGain: string;
  /** Past the tyres' life: the mark; not past: empty; unknown: its reason. */
  life: { past: boolean; reason?: UnknownReason | undefined };
  pmf: readonly number[];
  bold: boolean;
};

/** Cell widths (gen.mjs `swSpec`): full LAP 3, REJ 3, TRF 3, E[POS] 6, the strip, P(GAIN) 7, LIFE 4; compact LIFE 1. */
export const WIDTH = { lap: 3, rej: 3, trf: 3, ePos: 6, pGain: 7, life: 4, lifeCompact: 1 } as const;

const cellOf = (k: Known<number>, format: (n: number) => string): Cell =>
  k.known ? { text: format(k.value) } : { text: '', reason: k.reason };

/** The swept compound's letter; `auto` (unresolved) its option word. */
export const compoundLetter = (compound: PitSweep['compound']): string =>
  compound === 'auto' ? text.compoundChoice.auto : COMPOUND_MARK[compound].letter;

/** The compound cell's hover: resolved by auto or set in the panel options. */
export const compoundHover = (fromAuto: boolean): string => (fromAuto ? text.compoundHover.auto : text.compoundHover.set);

/** A row's cells. */
export function sweepLine(r: PitSweepRow): SweepLine {
  return {
    lap: formatLapNumber(r.stopLap, 2),
    rej: cellOf(r.rejoinPosition, formatPosition),
    trf: cellOf(r.traffic, formatCount),
    ePos: formatExpectedPlace(r.ePos),
    pGain: formatShare(r.pGain),
    life: r.pastLife.known ? { past: r.pastLife.value } : { past: false, reason: r.pastLife.reason },
    pmf: r.positionPmf,
    bold: r.inWindow,
  };
}

/**
 * The rows shown: every row when `fit` holds them, else `fit` rows centred on the window (the first window row to the
 * last), kept inside the table; without a window row, from the top.
 */
export function shownRows<R extends { inWindow: boolean }>(rows: readonly R[], fit: number): readonly R[] {
  const count = Math.max(0, fit);
  if (rows.length <= count) return rows;
  const first = rows.findIndex((r) => r.inWindow);
  if (first < 0) return rows.slice(0, count);
  let last = first;
  rows.forEach((r, i) => {
    if (r.inWindow) last = i;
  });
  const centre = Math.floor((first + last) / 2);
  const start = Math.min(Math.max(0, centre - Math.floor((count - 1) / 2)), rows.length - count);
  return rows.slice(start, start + count);
}

/** The strip's header: P1 at its first cell, P10 at its tenth, the last place at its end (gen.mjs `placesHeader`). */
export function placesHeader(places: number): string {
  let line = ' '.repeat(Math.max(0, places));
  const put = (label: string, at: number): void => {
    line = (line.slice(0, at) + label + line.slice(at + label.length)).slice(0, places);
  };
  if (places <= 0) return line;
  put(formatPosition(1), 0);
  if (places >= 20) put(formatPosition(10), 9);
  const lastLabel = formatPosition(places);
  if (places > 2 + lastLabel.length) put(lastLabel, places - lastLabel.length);
  return line;
}
