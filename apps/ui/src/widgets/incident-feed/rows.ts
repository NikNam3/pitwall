// Join and format logic of the incident feed: one pure function from the topics to display rows.
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, IncidentEntry, IncidentForUs, IncidentKind, IncidentPenalty, Known, RaceMoment, UnknownReason } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { fitCell, fitParts, knownPart, unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import { arrow, incidentKinds, warningKind, insightText, sectorNames, separator, topBar, unknownReason } from '../../kit/text.ts';
import type { WidgetSize } from '../../kit/types.ts';
import { formatCount, formatDeltaPct, formatLapNumber, formatSeconds, formatSignedSeconds } from '../../kit/values/format.ts';
import { positionPairParts } from '../../kit/values/position-mark.ts';
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

/**
 * One value of the for-us cell with the separator before it: `us`, ` P5→P4`, `, OCO`, ` +4.1→DNF`. A pair is one
 * piece; its arrow is notation, so it stays when both sides are unknown.
 */
type Piece = { lead: string; value: CellPart[] };

/** A piece whose value is wholly unknown (only marks) leaves the plain text, and its separator with it. */
const shown = (p: Piece): boolean => p.value.some((part) => part.reason === undefined);

/** A piece's plain text: its separator and its value's texts. */
const pieceText = (p: Piece): string => p.lead + p.value.map((part) => part.text).join('');

/** A piece's parts: its separator, then its value with each unknown's mark in place. */
const pieceParts = (p: Piece): CellPart[] => (p.lead === '' ? p.value : [{ text: p.lead }, ...p.value]);

/**
 * The pieces of `us P5→P4, OCO +4.1→DNF` with each unknown value in its place: `us …→P4, OCO +4.1→…`; the
 * position pair follows the gap pair's rule (kit `positionPairParts`). After the other car retired its gap after is
 * not applicable: `DNF`.
 */
function forUsPieces(f: IncidentForUs, cars: readonly CarOverview[]): Piece[] {
  const ours: Piece[] = [{ lead: '', value: [carCodeById(cars, f.ourCarId)] }, { lead: ' ', value: positionPairParts(f.positionBefore, f.positionAfter) }];
  if (!f.otherCarId.known) return ours;
  const after = f.gapAfterMs.known || f.gapAfterMs.reason !== 'notApplicable' ? knownPart(f.gapAfterMs, signedSeconds) : { text: text.retired };
  return [
    ...ours,
    { lead: text.joint, value: [carCodeById(cars, f.otherCarId.value)] },
    { lead: ' ', value: [knownPart(f.gapBeforeMs, signedSeconds), { text: arrow }, after] },
  ];
}

/**
 * What changed for one of our cars: `us P5→P4, OCO +4.1→DNF`; the gaps are to the car the analysis names. Built once
 * from its pieces: the plain text joins the shown ones, the parts are all of them, the hover reason the first mark's.
 */
function forUsCell(f: IncidentForUs, cars: readonly CarOverview[]): IncidentCell {
  const pieces = forUsPieces(f, cars);
  const cellText = pieces.filter(shown).map(pieceText).join('');
  const parts = pieces.flatMap(pieceParts);
  const reason = parts.find((p) => p.reason !== undefined)?.reason;
  return withParts(reason === undefined ? { text: cellText } : { text: cellText, reason }, parts);
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

/** What a warning was for: `corner cutting 2/3` (its count of the limit), or the infringement's name (`collision`), `warning` when we cannot name it. */
function warningDetail(warning: NonNullable<IncidentEntry['warning']>): string {
  if (warning.kind === 'cornerCutting' || warning.kind === undefined) return `${warningKind('cornerCutting')} ${text.warningCount(formatCount(warning.count), formatCount(warning.limit))}`;
  return warningKind('other', warning.infringement?.known ? warning.infringement.value : undefined);
}

/** The entry's detail: the damaged parts, a warning's count of the limit, a penalty's ruling, or the sector; empty when it has none known. */
function detailText(entry: IncidentEntry): string {
  if (entry.damage !== undefined) {
    return entry.damage.map((d) => text.damagePart(insightText.part[d.part], formatDeltaPct(d.deltaPct))).join(text.partsJoint);
  }
  if (entry.warning !== undefined) return warningDetail(entry.warning);
  if (entry.penalty !== undefined) return penaltyText(entry.penalty);
  return SECTOR_KINDS.has(entry.kind) && entry.where.sector.known ? sectorNames[entry.where.sector.value] : '';
}

/**
 * The kind and its detail, `time loss S2`; when both do not fit the what column, the detail alone (`FL wing +12 %`,
 * `drive-through`: the names say what it is), cut by the grid if even that is too long.
 */
function whatText(entry: IncidentEntry, cars: readonly CarOverview[]): string {
  if (entry.kind === 'neutralised' && entry.cause !== undefined && entry.neutralisation !== undefined) {
    const codes = entry.cause.carIds.map((id) => carCodeById(cars, id).text).filter((code) => code !== '');
    return text.neutralisedCause(topBar.phase[entry.neutralisation === 'red' ? 'red' : entry.neutralisation === 'VSC' ? 'vsc' : 'sc'], codes.join(text.carsJoint), incidentKinds[entry.cause.kind]);
  }
  const kind = incidentKinds[entry.kind];
  const detail = detailText(entry);
  if (detail === '') return kind;
  if (entry.warning !== undefined) return detail === warningKind('other') ? kind : text.warningWhat(kind, detail);
  const both = text.withDetail(kind, detail);
  return both.length <= widths.what ? both : detail;
}

/** The what cell; an infringement the game did not send leaves the reason on the hover. */
function whatCell(entry: IncidentEntry, cars: readonly CarOverview[]): IncidentCell {
  const cell: IncidentCell = { text: whatText(entry, cars) };
  const infringement = entry.warning?.kind === 'other' ? entry.warning.infringement : undefined;
  return infringement !== undefined && !infringement.known ? { ...cell, reason: infringement.reason } : cell;
}

/** One row per entry, in feed order. */
export function incidentRows(feed: readonly IncidentEntry[], cars: readonly CarOverview[], moment: Known<RaceMoment> | undefined): IncidentRow[] {
  return feed.map((entry) => {
    const lost: IncidentCell = knownPart(entry.timeLostMs, (ms) => text.lost(formatSeconds(ms, 1)));
    return {
      id: entry.id,
      role: incidentRole(moment, entry),
      cells: {
        lap: { text: formatLapNumber(entry.lap) },
        cars: carsCell(entry.carIds, cars),
        what: whatCell(entry, cars),
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
  cell.parts ?? (cell.text === '' ? [unknownPart(reason)] : [{ text: cell.text }, { text: ' ' }, unknownPart(reason)]);

/**
 * The width of a column that is not the last: its own, or, when its text is longer (a neutralisation's cause line,
 * `SC · ALO–TSU collision`) and every column after it is empty, as long as the text needs, so nothing after it moves.
 */
const spansOn = (after: readonly IncidentColumn[], row: IncidentRow, cell: IncidentCell, width: number): number =>
  cell.text.length > width && after.every((c) => row.cells[c].text === '') ? cell.text.length : width;

/**
 * The row's cells on the fixed grid of a line `cols` characters wide: each column in its width, the last one in what
 * is left of the line; a text that does not fit is cut with `…` (kit `fitCell`), never silently.
 */
export function fitRow(mode: WidgetSize['mode'], row: IncidentRow, cols: number): FittedCell[] {
  const columns = columnsFor(mode);
  const fixed = columns.slice(0, -1).reduce((sum, c) => sum + widths[c] + COLUMN_GAP, LEAD);
  return columns.map((column, i) => {
    const cell = row.cells[column];
    const last = i === columns.length - 1;
    const width = last ? Math.max(0, cols - fixed) : spansOn(columns.slice(i + 1), row, cell, widths[column]);
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
