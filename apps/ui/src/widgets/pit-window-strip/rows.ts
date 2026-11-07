// The pit-window strip's rows (SP4.2 spec §4; C65): the topic's sets picked and formatted, nothing computed. Every state,
// every lap and every window are `pit-window`'s (C43): a set's `state` and `windowLaps`, the stint's `stopNeeded` and
// `pastLimit`.
import type { PitWindow, PitWindowSet, PitWindowState } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatLapNumber, formatLapRange } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { lastLapEmphasis, windowEmphasis } from './emphasis.ts';

/** The sets shown: the same-type ones in topic order, then, with `showOther`, the other type's below them. */
export function visibleSets(window: PitWindow, showOther: boolean): PitWindowSet[] {
  const same = window.sets.filter((s) => s.sameType);
  return showOther ? [...same, ...window.sets.filter((s) => !s.sameType)] : same;
}

/** Whether the topic says no stop is needed (`stint.stopNeeded` false). */
export const noStop = (window: PitWindow): boolean => window.stint.stopNeeded.known && !window.stint.stopNeeded.value;

/** A set's window as the topic gives it: its laps and its state; undefined without one (`state` `none`) or while unknown. */
export function windowOf(set: PitWindowSet): { laps: { from: number; to: number }; state: PitWindowState } | undefined {
  if (!set.windowLaps.known || !set.state.known || set.state.value === 'none') return undefined;
  return { laps: set.windowLaps.value, state: set.state.value };
}

/** A window's laps as one text: `L23–31`, a one-lap window `L44`. */
export const windowText = (laps: { from: number; to: number }): string =>
  laps.from === laps.to ? formatLapNumber(laps.to, 2) : formatLapRange(laps.from, laps.to);

export type CompactRow = { letter: string; lap: CellPart; role: Role; bold: boolean };

/** The compact rows: the fitted set's last lap (none without a stop), then one row per visible set with a window. */
export function compactRows(window: PitWindow, showOther: boolean): CompactRow[] {
  const fitted: CompactRow = {
    letter: COMPOUND_MARK[window.stint.compound].letter,
    lap: noStop(window) ? { text: '' } : knownPart(window.stint.latest, (n) => formatLapNumber(n, 2)),
    ...lastLapEmphasis(window.stint.pastLimit),
  };
  const sets: CompactRow[] = [];
  for (const s of visibleSets(window, showOther)) {
    const own = windowOf(s);
    if (own === undefined) continue;
    sets.push({ letter: COMPOUND_MARK[s.compound].letter, lap: { text: windowText(own.laps) }, ...windowEmphasis(own.state) });
  }
  return [fitted, ...sets];
}
