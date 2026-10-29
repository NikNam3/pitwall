import type { BattleCard, BattleSide, Known, RaceMoment, UnknownReason, VisualCompound } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import { carCode } from '../../kit/car/car-code.ts';
import { gridRow, type GridColumn } from '../../kit/grid/grid.ts';
import { fixed, formatJoules, formatLaps } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { battleRole, type Side } from './emphasis.ts';
import * as text from './text.ts';

export type ColumnId = 'drv' | 'gap' | 'closing' | 'toDrs' | 'paceDelta' | 'margin' | 'tyres' | 'ers';
export type Cell = { text: string; role?: Role; reason?: UnknownReason };
export type TyrePair = { ours: { compound: VisualCompound; age: number }; theirs: { compound: VisualCompound; age: number } };
export type BattleRow = {
  label: 'AHEAD' | 'BEHIND';
  highlighted: boolean;
  cells: Record<ColumnId, Cell>;
  /** The tyre pair, for the compound marks; absent when the side is unknown. */
  tyres?: TyrePair;
};

const MINUS = '−';
const COLUMN_IDS: readonly ColumnId[] = ['drv', 'gap', 'closing', 'toDrs', 'paceDelta', 'margin', 'tyres', 'ers'];
const COMPACT: readonly ColumnId[] = ['drv', 'gap', 'toDrs'];
export const LABEL_WIDTH = 6;
/** The fixed field of each column. */
export const WIDTH: Record<ColumnId, GridColumn> = {
  drv: { width: 3, align: 'right' },
  gap: { width: 6, align: 'right' },
  closing: { width: 10, align: 'right' },
  toDrs: { width: 8, align: 'right' },
  paceDelta: { width: 6, align: 'right' },
  margin: { width: 6, align: 'right' },
  tyres: { width: 7, align: 'left' },
  ers: { width: 6, align: 'right' },
};
const LETTER: Record<VisualCompound, string> = { soft: 'S', medium: 'M', hard: 'H', superSoft: 'SS', inter: 'I', wet: 'W', unknown: '?' };

/** The columns of a size mode. */
export const columnsFor = (mode: 'compact' | 'full'): readonly ColumnId[] => (mode === 'compact' ? COMPACT : COLUMN_IDS);

/** Signed seconds with `decimals`; negative uses U+2212. `plus` also signs positives. */
const seconds = (ms: number, decimals: number, plus: boolean): string => {
  const s = fixed(Math.abs(ms) / 1000, decimals);
  return ms < 0 && Number(s) !== 0 ? `${MINUS}${s}` : plus ? `+${s}` : s;
};

const valueCell = <T>(v: Known<T>, format: (t: T) => string): Cell =>
  v.known ? { text: format(v.value) } : { text: '', reason: v.reason };

const tyreText = (side: BattleSide): string =>
  `${LETTER[side.ours.compound]}${side.ours.age} ${LETTER[side.theirs.compound]}${side.theirs.age}`;

function sideRow(label: BattleRow['label'], side: Side, card: BattleCard, cars: readonly CarOverview[], moment: Known<RaceMoment> | undefined): BattleRow {
  const known = card[side];
  if (!known.known) {
    const cells = Object.fromEntries(COLUMN_IDS.map((c) => [c, { text: '', reason: known.reason }])) as Record<ColumnId, Cell>;
    return { label, highlighted: false, cells };
  }
  const s = known.value;
  const highlight = battleRole(moment, card.carId, side);
  const car = cars.find((c) => c.id === s.carId);
  const sign = side === 'ahead' ? 1 : -1;
  const cells: Record<ColumnId, Cell> = {
    drv: { text: car === undefined ? '' : carCode(car.identity) },
    gap: valueCell(s.gapMs, (ms) => seconds(sign * ms, 3, true)),
    closing: valueCell(s.closingMsPerLap, (ms) => `${seconds(ms, 2, false)} ${text.perLap}`),
    toDrs: valueCell(s.lapsToDrs, (n) => (n === 0 ? text.inDrs : formatLaps(n))),
    paceDelta: valueCell(s.paceDeltaMs, (ms) => seconds(ms, 2, true)),
    margin: valueCell(s.overtakeMarginMs, (ms) => seconds(ms, 2, true)),
    tyres: { text: tyreText(s) },
    ers: valueCell(s.theirErsStoreJ, formatJoules),
  };
  if (highlight !== undefined) for (const c of ['drv', 'gap', 'toDrs'] as const) cells[c] = { ...cells[c], role: highlight };
  return { label, highlighted: highlight !== undefined, cells, tyres: { ours: s.ours, theirs: s.theirs } };
}

/** The two rows of a card, AHEAD then BEHIND; the moment lights the side its battle cause names. */
export function battleRows(card: BattleCard, cars: readonly CarOverview[], moment: Known<RaceMoment> | undefined): BattleRow[] {
  return [sideRow(text.ahead, 'ahead', card, cars, moment), sideRow(text.behind, 'behind', card, cars, moment)];
}

const grid = (mode: 'compact' | 'full'): GridColumn[] => [{ width: LABEL_WIDTH }, ...columnsFor(mode).map((c) => WIDTH[c])];

/** The header line over the fixed fields. */
export const battleHeader = (mode: 'compact' | 'full'): string =>
  gridRow(grid(mode), ['', ...columnsFor(mode).map((c) => text.header[c])]);

/** A row as one line of fixed fields. */
export const battleRowText = (mode: 'compact' | 'full', row: BattleRow): string =>
  gridRow(grid(mode), [row.label, ...columnsFor(mode).map((c) => row.cells[c].text)]);
