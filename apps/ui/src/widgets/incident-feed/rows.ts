// Join and format logic of the incident feed: one pure function from the topics to display rows.
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, IncidentEntry, IncidentForUs, Known, RaceMoment, UnknownReason } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { fitCell } from '../../kit/grid/grid.ts';
import { incidentKinds, separator, unknownReason } from '../../kit/text.ts';
import type { WidgetSize } from '../../kit/types.ts';
import { formatLapNumber, formatSeconds, formatSignedSeconds } from '../../kit/values/format.ts';
import { positionPairText } from '../../kit/values/position-mark.ts';
import type { Role } from '../../theme/roles.ts';
import { incidentRole } from './emphasis.ts';
import * as text from './text.ts';

export type IncidentColumn = 'lap' | 'cars' | 'what' | 'lost' | 'forUs';
export type IncidentCell = { text: string; reason?: UnknownReason };
export type IncidentRow = { id: string; role?: Role | undefined; cells: Record<IncidentColumn, IncidentCell> };

const signedSeconds = (ms: number): string => formatSignedSeconds(ms, 1);

/** The first reason among values that are unknown. */
const firstReason = (...values: Known<unknown>[]): UnknownReason | undefined => values.find((v) => !v.known)?.reason;

/** Our gap to the other car before and after: `+4.1→+5.8`; after it retired, `+4.1→DNF` (its gap after is not applicable). */
function gapText(before: Known<number>, after: Known<number>): string {
  if (!before.known && !after.known && after.reason !== 'notApplicable') return '';
  const b = before.known ? signedSeconds(before.value) : '';
  const a = after.known ? signedSeconds(after.value) : after.reason === 'notApplicable' ? text.retired : '';
  return text.pair(b, a);
}

/** What changed for one of our cars: `us P5→P4, OCO +4.1→DNF`; the gaps are to the car the analysis names. */
function forUsCell(f: IncidentForUs, cars: readonly CarOverview[]): IncidentCell {
  const position = f.positionBefore.known ? positionPairText(f.positionBefore.value, f.positionAfter) : '';
  const lead = position === '' ? text.us : `${text.us} ${position}`;
  if (!f.otherCarId.known) {
    const reason = firstReason(f.positionBefore, f.positionAfter);
    return reason === undefined ? { text: lead } : { text: lead, reason };
  }
  const code = carCodeById(cars, f.otherCarId.value);
  const gap = gapText(f.gapBeforeMs, f.gapAfterMs);
  const gapAfter = f.gapAfterMs.known || f.gapAfterMs.reason === 'notApplicable' ? [] : [f.gapAfterMs];
  const reason = firstReason(f.positionBefore, f.positionAfter, f.gapBeforeMs, ...gapAfter) ?? code.reason;
  const other = [code.text, gap].filter((t) => t !== '').join(' ');
  const cellText = gap === '' ? lead : `${lead}${text.joint}${other}`;
  return reason === undefined ? { text: cellText } : { text: cellText, reason };
}

/** Every one of our cars the entry concerns, one after the other; the hover gives the first reason. */
function forUsCells(entry: IncidentEntry, cars: readonly CarOverview[]): IncidentCell {
  const cells = entry.forUs.map((f) => forUsCell(f, cars));
  const joined = cells.map((c) => c.text).join(separator);
  const reason = cells.find((c) => c.reason !== undefined)?.reason;
  return reason === undefined ? { text: joined } : { text: joined, reason };
}

/** The codes of the entry's cars; a car the field lacks is left out and its reason goes to the hover. */
function carsCell(ids: readonly CarId[], cars: readonly CarOverview[]): IncidentCell {
  const codes = ids.map((id) => carCodeById(cars, id));
  const text = codes.flatMap((c) => (c.text === '' ? [] : [c.text])).join(' ');
  const reason = codes.find((c) => c.reason !== undefined)?.reason;
  return reason === undefined ? { text } : { text, reason };
}

/** One row per entry, in feed order. */
export function incidentRows(feed: readonly IncidentEntry[], cars: readonly CarOverview[], moment: Known<RaceMoment> | undefined): IncidentRow[] {
  return feed.map((entry) => {
    const lost: IncidentCell = entry.timeLostMs.known ? { text: text.lost(formatSeconds(entry.timeLostMs.value, 1)) } : { text: '', reason: entry.timeLostMs.reason };
    return {
      id: entry.id,
      role: incidentRole(moment, entry),
      cells: {
        lap: { text: formatLapNumber(entry.lap) },
        cars: carsCell(entry.carIds, cars),
        what: { text: incidentKinds[entry.kind] },
        lost,
        forUs: forUsCells(entry, cars),
      },
    };
  });
}

/** The columns a size mode shows. */
export const columnsFor = (mode: WidgetSize['mode']): IncidentColumn[] =>
  mode === 'full' ? ['lap', 'cars', 'what', 'lost', 'forUs'] : ['lap', 'cars', 'what'];

/** Character widths of the grid; the last column shown takes the rest of the line. */
export const widths: Record<IncidentColumn, number> = { lap: 3, cars: 7, what: 18, lost: 10, forUs: 0 };

/** Spaces between two columns, and the lead space before the first. */
export const COLUMN_GAP = 2;
export const LEAD = 1;

/** One cell fitted to its field: the text and, for an empty value, the reason in words for the hover. */
export type FittedCell = { column: IncidentColumn; text: string; title?: string };

/**
 * The row's cells on the fixed grid of a line `cols` characters wide: each column in its width, the last one in what
 * is left of the line; a text that does not fit is cut with `…` (kit `fitCell`), never silently.
 */
export function fitRow(mode: WidgetSize['mode'], row: IncidentRow, cols: number): FittedCell[] {
  const columns = columnsFor(mode);
  const fixed = columns.slice(0, -1).reduce((sum, c) => sum + widths[c] + COLUMN_GAP, LEAD);
  return columns.map((column, i) => {
    const cell = row.cells[column];
    const width = i === columns.length - 1 ? Math.max(0, cols - fixed) : widths[column];
    const fitted = { column, text: fitCell(cell.text, width) };
    return cell.reason === undefined ? fitted : { ...fitted, title: unknownReason[cell.reason] };
  });
}

/** A row as one line of text on the fixed grid (`cols` wide; by default as wide as its last cell needs). */
export function incidentRowText(mode: WidgetSize['mode'], row: IncidentRow, cols = Infinity): string {
  const columns = columnsFor(mode);
  const last = columns[columns.length - 1];
  const needed = columns.slice(0, -1).reduce((sum, c) => sum + widths[c] + COLUMN_GAP, LEAD) + (last === undefined ? 0 : row.cells[last].text.length);
  const cells = fitRow(mode, row, Math.min(cols, needed));
  return `${' '.repeat(LEAD)}${cells.map((c) => c.text).join(' '.repeat(COLUMN_GAP))}`.trimEnd();
}
