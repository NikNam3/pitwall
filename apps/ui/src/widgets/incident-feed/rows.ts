// Join and format logic of the incident feed: one pure function from the topics to display rows.
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, IncidentEntry, IncidentForUs, Known, RaceMoment, UnknownReason } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { gridRow } from '../../kit/grid/grid.ts';
import type { GridColumn } from '../../kit/grid/grid.ts';
import { incidentKinds, separator } from '../../kit/text.ts';
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
export const columnsFor = (mode: string): IncidentColumn[] => (mode === 'full' ? ['lap', 'cars', 'what', 'lost', 'forUs'] : ['lap', 'cars', 'what']);

/** Character widths of the grid; the last column is free. */
export const widths: Record<IncidentColumn, number> = { lap: 3, cars: 7, what: 18, lost: 10, forUs: 0 };

/** A row as one line of text on the fixed grid. */
export function incidentRowText(mode: string, row: IncidentRow): string {
  const columns = columnsFor(mode);
  const grid: GridColumn[] = columns.map((c) => ({ width: c === 'forUs' ? row.cells.forUs.text.length : widths[c], align: 'left' }));
  return ` ${gridRow(grid, columns.map((c) => row.cells[c].text), 2)}`.trimEnd();
}
