// Pure join of the three topics into display rows for the corner block: texts, roles and hidden reasons.
import type { CarBands, CarState, Corners, Known, TyreWear, UnknownReason } from '@pitwall/domain';
import { gridRow } from '../../kit/grid/grid.ts';
import type { GridColumn } from '../../kit/grid/grid.ts';
import { formatCelsius, formatPercent, formatPsi, formatWhole } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { bandRole } from './emphasis.ts';
import { columnHeaders, engineUnit } from './text.ts';

/** One value: `text` for the full table, `compactText` for the compact view; both empty when hidden, with the reason. */
export type Cell = { text: string; compactText: string; role?: Role; reason?: UnknownReason };
export type CornerRow = { surface: Cell; carcass: Cell; pressure: Cell; brake: Cell; wear: Cell };
export type CornerBlockRows = { corners: Corners<CornerRow>; engine: Cell };

/** Full-table columns: label, surface, carcass, pressure, brake, wear. */
export const FULL_COLUMNS: readonly GridColumn[] = [
  { width: 2, align: 'left' }, { width: 5, align: 'right' }, { width: 5, align: 'right' },
  { width: 5, align: 'right' }, { width: 6, align: 'right' }, { width: 5, align: 'right' },
];

const none = (reason: UnknownReason): Cell => ({ text: '', compactText: '', reason });

function cell(value: Known<number>, text: (n: number) => string, compact: (n: number) => string, role?: Role): Cell {
  if (!value.known) return none(value.reason);
  const base: Cell = { text: text(value.value), compactText: compact(value.value) };
  return role === undefined ? base : { ...base, role };
}

/** Joins the car's values, the band readings and the wear into the rows the display shows. */
export function cornerBlockRows(car: CarState, bands: CarBands, wear: TyreWear): CornerBlockRows {
  const row = (name: keyof Corners<unknown>): CornerRow => {
    const tyre = car.tyres.corners[name];
    const band = bands.tyres[name];
    return {
      surface: cell(tyre.surfaceTempC, formatWhole, formatCelsius, bandRole(band.surfaceC)),
      carcass: cell(tyre.carcassTempC, formatWhole, formatCelsius, bandRole(band.carcassC)),
      pressure: cell(tyre.pressurePsi, formatPsi, formatPsi, bandRole(band.pressurePsi)),
      brake: cell(car.condition.brakes[name].tempC, formatWhole, formatWhole, bandRole(bands.brakesC[name])),
      wear: cell(wear.corners[name].wearPct, formatPercent, formatPercent),
    };
  };
  return {
    corners: { fl: row('fl'), fr: row('fr'), rl: row('rl'), rr: row('rr') },
    engine: cell(car.condition.engineTempC, (n) => `${formatWhole(n)}${engineUnit}`, formatWhole, bandRole(bands.engineC)),
  };
}

/** The full table's header line, over the same fixed fields as `fullRowText`. */
export const fullHeader = (): string => gridRow(FULL_COLUMNS, columnHeaders);

/** One full-table row as plain text (the component colours the cells itself). */
export const fullRowText = (name: string, row: CornerRow): string =>
  gridRow(FULL_COLUMNS, [name.toUpperCase(), row.surface.text, row.carcass.text, row.pressure.text, row.brake.text, row.wear.text]);

const rankOf = (role: Role | undefined): number => (role === 'critical' ? 2 : role === 'warning' ? 1 : 0);

/** The brake to show in the compact view: worst role first, then the hottest; hidden brakes are skipped. */
export function worstBrake(rows: CornerBlockRows): { corner: keyof Corners<unknown>; cell: Cell } | undefined {
  let best: { corner: keyof Corners<unknown>; cell: Cell; temp: number } | undefined;
  for (const corner of ['fl', 'fr', 'rl', 'rr'] as const) {
    const c = rows.corners[corner].brake;
    if (c.text === '') continue;
    const temp = Number(c.text);
    const better = best === undefined || rankOf(c.role) > rankOf(best.cell.role) || (rankOf(c.role) === rankOf(best.cell.role) && temp > best.temp);
    if (better) best = { corner, cell: c, temp };
  }
  return best === undefined ? undefined : { corner: best.corner, cell: best.cell };
}
