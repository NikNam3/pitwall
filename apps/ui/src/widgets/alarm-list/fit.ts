// What of the alarm list fits the panel: at most `rows` lines, each at most `cols` characters (the fit rule, spec 9.3).
import type { Insight } from '@pitwall/domain';
import { fitCell } from '../../kit/grid/grid.ts';
import type { AlarmRow, AlarmView } from './rows.ts';
import * as text from './text.ts';

/** Width of the severity label (`CRIT`, `ADV`) in characters; AlarmList.svelte sets the same width. */
export const SEVERITY_COLS = 5;

/** A listed alarm with its text cut to the room it has. */
export type FittedRow = AlarmRow & { text: string };

/** The rows shown, how many more there are (counted on the last line), and the muted entries that fit their line. */
export type FittedAlarms = { rows: FittedRow[]; more: number; muted: AlarmView['muted'] };

/** Characters of a row beside its text: label, the ack button or "acknowledged", and in full mode the mute button. */
const besideText = (row: AlarmRow, full: boolean): number =>
  SEVERITY_COLS + 1 + 1 + (row.acknowledged ? text.acknowledged : text.ack).length + (full ? 1 + text.muteGroup(row.insight.category).length : 0);

/**
 * Fits `view` into `size`: every row and the muted line when they fit; else the first `rows - 1` alarms and a last line
 * with the count of the rest followed by the muted entries. Insight texts are cut with `fitCell`; muted entries that
 * would run past `cols` are left out.
 */
export function fitAlarms(view: AlarmView, size: { cols: number; rows: number }, full: boolean, format: (insight: Insight) => string): FittedAlarms {
  const mutedLines = view.muted.length > 0 ? 1 : 0;
  const fits = view.rows.length + mutedLines <= size.rows;
  const shown = fits ? view.rows : view.rows.slice(0, Math.max(0, size.rows - 1));
  const more = view.rows.length - shown.length;
  const rows = shown.map((row) => ({ ...row, text: fitCell(format(row.insight), size.cols - besideText(row, full)).trimEnd() }));
  let used = more > 0 ? text.more(more).length + 1 + text.mutedLabel.length : text.mutedLabel.length;
  const muted: AlarmView['muted'] = [];
  for (const m of view.muted) {
    used += 1 + text.mutedGroup(m.category, m.count).length;
    if (used > size.cols) break;
    muted.push(m);
  }
  return { rows, more, muted };
}
