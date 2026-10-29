// Pure join of the three topics into display rows for the corner block: texts, roles, staleness and hidden reasons.
import type { CarBands, CarState, Corners, Known, TyreWear, UnknownReason } from '@pitwall/domain';
import { fitCell, gridRow } from '../../kit/grid/grid.ts';
import type { GridColumn } from '../../kit/grid/grid.ts';
import { staleRole } from '../../kit/stale/stale.ts';
import { cornerNames } from '../../kit/text.ts';
import type { CarFieldPath } from '../../kit/values/car-sources.ts';
import { formatCelsius, formatPercent, formatPsi, formatTemp, formatWhole } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { bandRole } from './emphasis.ts';
import { columnHeaders } from './text.ts';

/**
 * One value: the raw `value`, `text` for the full table and `compactText` for the compact view; both texts empty when
 * hidden, with the reason. `stale` when its car field fell behind; the role is then faint.
 */
export type Cell = { value: Known<number>; text: string; compactText: string; role?: Role; reason?: UnknownReason; stale?: true };
export type CornerRow = { surface: Cell; carcass: Cell; pressure: Cell; brake: Cell; wear: Cell };
export type CornerBlockRows = { corners: Corners<CornerRow>; engine: Cell };
type CornerName = keyof Corners<unknown>;

/** Full-table columns: label, surface, carcass, pressure, brake, wear. */
export const FULL_COLUMNS: readonly GridColumn[] = [
  { width: 2, align: 'left' }, { width: 5, align: 'right' }, { width: 5, align: 'right' },
  { width: 5, align: 'right' }, { width: 6, align: 'right' }, { width: 5, align: 'right' },
];

/** The car fields the block shows (wear comes from `tyreWear.car`), for the kit's stale path. */
export const CAR_FIELDS = [
  'tyres.corners.surfaceTempC',
  'tyres.corners.carcassTempC',
  'tyres.corners.pressurePsi',
  'condition.brakes.tempC',
  'condition.engineTempC',
] as const satisfies readonly CarFieldPath[];

type Format = (n: number) => string;
type Spec = { text: Format; compact: Format; role?: Role | undefined; stale?: boolean };

function cell(value: Known<number>, spec: Spec): Cell {
  if (!value.known) return { value, text: '', compactText: '', reason: value.reason };
  const base: Cell = { value, text: spec.text(value.value), compactText: spec.compact(value.value) };
  const stale = spec.stale === true;
  const role = staleRole(spec.role, stale);
  return { ...base, ...(role !== undefined && { role }), ...(stale && { stale: true as const }) };
}

/**
 * Joins the car's values, the band readings and the wear into the rows the display shows. `isStale` tells which car
 * fields fell behind (the panel clock decides; by default none).
 */
export function cornerBlockRows(car: CarState, bands: CarBands, wear: TyreWear, isStale: (field: CarFieldPath) => boolean = () => false): CornerBlockRows {
  const of = (field: CarFieldPath, text: Format, compact: Format, role: Role | undefined): Spec => ({ text, compact, role, stale: isStale(field) });
  const row = (name: CornerName): CornerRow => {
    const tyre = car.tyres.corners[name];
    const band = bands.tyres[name];
    return {
      surface: cell(tyre.surfaceTempC, of('tyres.corners.surfaceTempC', formatWhole, formatTemp, bandRole(band.surfaceC))),
      carcass: cell(tyre.carcassTempC, of('tyres.corners.carcassTempC', formatWhole, formatTemp, bandRole(band.carcassC))),
      pressure: cell(tyre.pressurePsi, of('tyres.corners.pressurePsi', formatPsi, formatPsi, bandRole(band.pressurePsi))),
      brake: cell(car.condition.brakes[name].tempC, of('condition.brakes.tempC', formatWhole, formatWhole, bandRole(bands.brakesC[name]))),
      wear: cell(wear.corners[name].wearPct, { text: formatPercent, compact: formatPercent }),
    };
  };
  return {
    corners: { fl: row('fl'), fr: row('fr'), rl: row('rl'), rr: row('rr') },
    engine: cell(car.condition.engineTempC, of('condition.engineTempC', formatCelsius, formatWhole, bandRole(bands.engineC))),
  };
}

/** The full table's header line, over the same fixed fields as `fullRowText`. */
export const fullHeader = (): string => gridRow(FULL_COLUMNS, columnHeaders);

/** One field of a full-table row: its text fitted to the column, and the value's cell (the label has none). */
export type RowField = { text: string; cell?: Cell };

/** One full-table row as the fields the display renders (it colours each cell); joined by one space they are `fullRowText`. */
export function fullRowFields(name: CornerName, row: CornerRow): RowField[] {
  const cells = [row.surface, row.carcass, row.pressure, row.brake, row.wear];
  return FULL_COLUMNS.map((column, i): RowField => {
    const c = cells[i - 1];
    const text = fitCell(c === undefined ? cornerNames[name] : c.text, column.width, column.align);
    return c === undefined ? { text } : { text, cell: c };
  });
}

/** One full-table row as plain text, the layout `fullRowFields` renders. */
export const fullRowText = (name: CornerName, row: CornerRow): string => fullRowFields(name, row).map((f) => f.text).join(' ');

const rankOf = (role: Role | undefined): number => (role === 'critical' ? 2 : role === 'warning' ? 1 : 0);

/** The brake to show in the compact view: worst role first, then the hottest raw temperature; hidden brakes are skipped. */
export function worstBrake(rows: CornerBlockRows): { corner: CornerName; cell: Cell } | undefined {
  let best: { corner: CornerName; cell: Cell; temp: number } | undefined;
  for (const corner of ['fl', 'fr', 'rl', 'rr'] as const) {
    const c = rows.corners[corner].brake;
    if (!c.value.known) continue;
    const temp = c.value.value;
    const better = best === undefined || rankOf(c.role) > rankOf(best.cell.role) || (rankOf(c.role) === rankOf(best.cell.role) && temp > best.temp);
    if (better) best = { corner, cell: c, temp };
  }
  return best === undefined ? undefined : { corner: best.corner, cell: best.cell };
}

/** The compact view's brake: `FR 1043` with the worst brake's cell, or empty with a hidden brake's reason when all are hidden. */
export function compactBrake(rows: CornerBlockRows): { text: string; cell: Cell } {
  const worst = worstBrake(rows);
  if (worst === undefined) return { text: '', cell: rows.corners.fl.brake };
  return { text: `${cornerNames[worst.corner]} ${worst.cell.compactText}`, cell: worst.cell };
}
