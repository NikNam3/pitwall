// Join and format logic of the incident feed: one pure function from the topics to display rows.
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, IncidentEntry, IncidentForUs, IncidentKind, IncidentPenalty, Known, RaceMoment, UnknownReason } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { fitCell, fitParts, type CellPart } from '../../kit/grid/grid.ts';
import { incidentKinds, insightText, sectorNames, separator, unknownReason } from '../../kit/text.ts';
import type { WidgetSize } from '../../kit/types.ts';
import { formatCount, formatDeltaPct, formatLapNumber, formatSeconds, formatSignedSeconds } from '../../kit/values/format.ts';
import { positionPairText } from '../../kit/values/position-mark.ts';
import type { Role } from '../../theme/roles.ts';
import { incidentRole } from './emphasis.ts';
import * as text from './text.ts';

export type IncidentColumn = 'lap' | 'cars' | 'what' | 'lost' | 'forUs';
/**
 * A cell: its plain text (no marks) and the first reason of its unknown values; `parts` when the cell places each
 * unknown's mark at its value (the for-us cell), else the mark goes after the text.
 */
export type IncidentCell = { text: string; reason?: UnknownReason; parts?: CellPart[] };
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

/** A known value's text, or the unknown's part (its mark shows in place). */
const valuePart = <T>(v: Known<T>, format: (t: T) => string): CellPart => (v.known ? { text: format(v.value) } : { text: '', reason: v.reason });

/**
 * The parts of `us P5→P4, OCO +4.1→DNF` with each unknown value in its place: `us …, OCO +4.1→…`; the gaps show (as
 * marks) even when both are unknown, which the plain text leaves out.
 */
function forUsParts(f: IncidentForUs, cars: readonly CarOverview[]): CellPart[] {
  const position: CellPart[] = f.positionBefore.known
    ? [{ text: positionPairText(f.positionBefore.value, f.positionAfter) }, ...(f.positionAfter.known ? [] : [valuePart(f.positionAfter, String)])]
    : [valuePart(f.positionBefore, String)];
  const parts: CellPart[] = [{ text: text.us }, { text: ' ' }, ...position];
  if (!f.otherCarId.known) return parts;
  const code = carCodeById(cars, f.otherCarId.value);
  const after = f.gapAfterMs.known || f.gapAfterMs.reason !== 'notApplicable' ? valuePart(f.gapAfterMs, signedSeconds) : { text: text.retired };
  return [...parts, { text: text.joint }, code, { text: ' ' }, valuePart(f.gapBeforeMs, signedSeconds), { text: text.arrow }, after];
}

/** What changed for one of our cars: `us P5→P4, OCO +4.1→DNF`; the gaps are to the car the analysis names. */
function forUsCell(f: IncidentForUs, cars: readonly CarOverview[]): IncidentCell {
  const position = f.positionBefore.known ? positionPairText(f.positionBefore.value, f.positionAfter) : '';
  const lead = position === '' ? text.us : `${text.us} ${position}`;
  if (!f.otherCarId.known) {
    const reason = firstReason(f.positionBefore, f.positionAfter);
    return withParts(reason === undefined ? { text: lead } : { text: lead, reason }, forUsParts(f, cars));
  }
  const code = carCodeById(cars, f.otherCarId.value);
  const gap = gapText(f.gapBeforeMs, f.gapAfterMs);
  const gapAfter = f.gapAfterMs.known || f.gapAfterMs.reason === 'notApplicable' ? [] : [f.gapAfterMs];
  const reason = firstReason(f.positionBefore, f.positionAfter, f.gapBeforeMs, ...gapAfter) ?? code.reason;
  const other = [code.text, gap].filter((t) => t !== '').join(' ');
  const cellText = gap === '' ? lead : `${lead}${text.joint}${other}`;
  return withParts(reason === undefined ? { text: cellText } : { text: cellText, reason }, forUsParts(f, cars));
}

/** The cell with its parts, when one of them is unknown (a known cell shows its text alone). */
const withParts = (cell: IncidentCell, parts: CellPart[]): IncidentCell => (parts.some((p) => p.reason !== undefined) ? { ...cell, parts } : cell);

/** Every one of our cars the entry concerns, one after the other; the hover gives the first reason. */
function forUsCells(entry: IncidentEntry, cars: readonly CarOverview[]): IncidentCell {
  const cells = entry.forUs.map((f) => forUsCell(f, cars));
  const joined = cells.map((c) => c.text).join(separator);
  const reason = cells.find((c) => c.reason !== undefined)?.reason;
  const parts = cells.flatMap((c, i) => [...(i === 0 ? [] : [{ text: separator }]), ...(c.parts ?? [{ text: c.text }])]);
  return withParts(reason === undefined ? { text: joined } : { text: joined, reason }, parts);
}

/** The codes of the entry's cars; a car the field lacks is left out and its reason goes to the hover. */
function carsCell(ids: readonly CarId[], cars: readonly CarOverview[]): IncidentCell {
  const codes = ids.map((id) => carCodeById(cars, id));
  const text = codes.flatMap((c) => (c.text === '' ? [] : [c.text])).join(' ');
  const reason = codes.find((c) => c.reason !== undefined)?.reason;
  return reason === undefined ? { text } : { text, reason };
}

/** The kinds whose detail is where they happened. */
const SECTOR_KINDS: ReadonlySet<IncidentKind> = new Set(['collision', 'timeLoss']);

/** A penalty's ruling: `drive-through`, `+5 s`; empty for a time penalty the game sent no time for. */
function penaltyText(penalty: IncidentPenalty): string {
  if (penalty.kind !== 'time') return text.penaltyKinds[penalty.kind];
  return penalty.timeMs === undefined ? '' : text.timePenalty(formatSeconds(penalty.timeMs, 0));
}

/** The entry's detail: the damaged parts, a warning's count of the limit, a penalty's ruling, or the sector; empty when it has none known. */
function detailText(entry: IncidentEntry): string {
  if (entry.damage !== undefined) {
    return entry.damage.map((d) => text.damagePart(insightText.part[d.part], formatDeltaPct(d.deltaPct))).join(text.partsJoint);
  }
  if (entry.warning !== undefined) return text.warningCount(formatCount(entry.warning.count), formatCount(entry.warning.limit));
  if (entry.penalty !== undefined) return penaltyText(entry.penalty);
  return SECTOR_KINDS.has(entry.kind) && entry.where.sector.known ? sectorNames[entry.where.sector.value] : '';
}

/**
 * The kind and its detail, `time loss S2`; when both do not fit the what column, the detail alone (`FL wing +12 %`,
 * `drive-through`: the names say what it is), cut by the grid if even that is too long.
 */
function whatText(entry: IncidentEntry): string {
  const kind = incidentKinds[entry.kind];
  const detail = detailText(entry);
  if (detail === '') return kind;
  const both = text.withDetail(kind, detail);
  return both.length <= widths.what ? both : detail;
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
        what: { text: whatText(entry) },
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

/**
 * One cell fitted to its field: the plain text and, for a cell with an unknown value, the reason in words for the hover
 * and its parts fitted to the width (kit `fitParts`), each mark where its value goes.
 */
export type FittedCell = { column: IncidentColumn; text: string; title?: string; parts?: CellPart[] };

/** The parts of a cell with an unknown value: its own, or its text with the mark after it. */
const partsOf = (cell: IncidentCell, reason: UnknownReason): CellPart[] =>
  cell.parts ?? (cell.text === '' ? [{ text: '', reason }] : [{ text: cell.text }, { text: ' ' }, { text: '', reason }]);

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
    return cell.reason === undefined ? fitted : { ...fitted, title: unknownReason[cell.reason], parts: fitParts(partsOf(cell, cell.reason), width) };
  });
}

/** A row as one line of text on the fixed grid (`cols` wide; by default as wide as its last cell needs), without the marks. */
export function incidentRowText(mode: WidgetSize['mode'], row: IncidentRow, cols = Infinity): string {
  const columns = columnsFor(mode);
  const last = columns[columns.length - 1];
  const needed = columns.slice(0, -1).reduce((sum, c) => sum + widths[c] + COLUMN_GAP, LEAD) + (last === undefined ? 0 : row.cells[last].text.length);
  const cells = fitRow(mode, row, Math.min(cols, needed));
  return `${' '.repeat(LEAD)}${cells.map((c) => c.text).join(' '.repeat(COLUMN_GAP))}`.trimEnd();
}
