// The pit-window strip's rows (SP4.2 spec §4; C65): the topic's sets picked and formatted, nothing computed. The window
// state, every lap and whether a set reaches the flag are `pit-window`'s (C43).
import type { PitWindow, PitWindowSet, PitWindowState } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatLapNumber, formatLapRange } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { lastLapEmphasis, windowEmphasis, type Emphasis } from './emphasis.ts';

/** The sets shown: the same-type ones in topic order, then, with `showOther`, the other type's below them. */
export function visibleSets(window: PitWindow, showOther: boolean): PitWindowSet[] {
  const same = window.sets.filter((s) => s.sameType);
  return showOther ? [...same, ...window.sets.filter((s) => !s.sameType)] : same;
}

/** Whether a set has a window: it reaches the flag when fitted at the latest stop lap (the analysis' `reaches`). */
export const hasWindow = (set: PitWindowSet): boolean => set.reaches.known && set.reaches.value;

/** The window state a set's row shows: `pit-window`'s for its window compound; a closed window closes every set's; else none. */
export function setState(window: PitWindow, set: PitWindowSet): PitWindowState {
  if (!window.window.known) return 'none';
  const state = window.window.value;
  if (window.windowCompound.known && window.windowCompound.value === set.compound) return state;
  return state === 'closed' ? 'closed' : 'none';
}

/** A window's laps as one text: `L23–31`, a one-lap window `L44`. */
export const windowText = (earliest: number, latest: number): string =>
  earliest === latest ? formatLapNumber(latest, 2) : formatLapRange(earliest, latest);

/** The fitted set's last lap emphasis; the text colour while the window or the last lap is unknown. */
export function fittedEmphasis(window: PitWindow): Emphasis {
  if (!window.window.known || !window.stint.latest.known) return windowEmphasis('none');
  return lastLapEmphasis(window.window.value, window.stint.latest.value, window.currentLap);
}

export type CompactRow = { letter: string; lap: CellPart; role: Role; bold: boolean };

/** The compact rows: the fitted set's last lap, then one row per visible set with a window. */
export function compactRows(window: PitWindow, showOther: boolean): CompactRow[] {
  const fitted: CompactRow = {
    letter: COMPOUND_MARK[window.stint.compound].letter,
    lap: knownPart(window.stint.latest, (n) => formatLapNumber(n, 2)),
    ...fittedEmphasis(window),
  };
  const latest = window.stint.latest;
  const sets: CompactRow[] = [];
  if (latest.known) {
    for (const s of visibleSets(window, showOther)) {
      if (!hasWindow(s) || !s.earliest.known) continue;
      sets.push({
        letter: COMPOUND_MARK[s.compound].letter,
        lap: { text: windowText(s.earliest.value, latest.value) },
        ...windowEmphasis(setState(window, s)),
      });
    }
  }
  return [fitted, ...sets];
}
