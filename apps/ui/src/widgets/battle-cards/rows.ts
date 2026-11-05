import { unknown, type BattleCard, type BattleSide, type DrsStatus, type Known, type RaceMoment, type VisualCompound } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import { carCodeById } from '../../kit/car/car-label.ts';
import { gridRow, knownPart, unknownPart, type CellPart, type GridColumn } from '../../kit/grid/grid.ts';
import { compoundText } from '../../kit/compound/compound-mark.ts';
import { formatJoules, formatLaps, formatSecondsPerLap, formatSignedSeconds } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import type { WidgetSize } from '../../kit/types.ts';
import { battleRole, marginRole, type Side } from './emphasis.ts';
import * as text from './text.ts';

export type ColumnId = 'drv' | 'gap' | 'paceDelta' | 'margin' | 'toDrs' | 'tyres' | 'ers';
/** A field: a part (its text, or why it is unknown) with its emphasis and what it means on hover (`title`). */
export type Cell = CellPart & { role?: Role; title?: string };
export type TyrePair = { ours: { compound: VisualCompound; age: number }; theirs: { compound: VisualCompound; age: number } };
export type BattleRow = {
  label: 'AHEAD' | 'BEHIND';
  highlighted: boolean;
  cells: Record<ColumnId, Cell>;
  /** The tyre pair, for the compound marks; absent when the side is unknown. */
  tyres?: TyrePair;
};

const COLUMN_IDS: readonly ColumnId[] = ['drv', 'gap', 'paceDelta', 'margin', 'toDrs', 'tyres', 'ers'];
const COMPACT: readonly ColumnId[] = ['drv', 'gap', 'toDrs'];
export const LABEL_WIDTH = 6;
/** The fixed field of each column. */
export const WIDTH: Record<ColumnId, GridColumn> = {
  drv: { width: 3, align: 'right' },
  gap: { width: 6, align: 'right' },
  toDrs: { width: 8, align: 'right' },
  paceDelta: { width: 11, align: 'right' },
  margin: { width: 16, align: 'right' },
  tyres: { width: 7, align: 'left' },
  ers: { width: 6, align: 'right' },
};

/** The columns of a size mode. */
export const columnsFor = (mode: WidgetSize['mode']): readonly ColumnId[] => (mode === 'compact' ? COMPACT : COLUMN_IDS);

/**
 * The sign of a side's gap, the app-wide convention (as the tower's TO US): a car ahead of us negative, behind
 * positive. `battle.cards` gives each side's gap as an unsigned distance, so the display only picks the side's sign.
 */
const GAP_SIGN: Record<Side, 1 | -1> = { ahead: -1, behind: 1 };

/** TO DRS: the laps to DRS range, or "DRS off" with race control's reason while DRS is off. */
const toDrsCell = (lapsToDrs: Known<number>, drs: DrsStatus): Cell =>
  drs.enabled ? knownPart(lapsToDrs, (n) => (n === 0 ? text.inDrs : formatLaps(n))) : { text: text.drsOff, title: text.drsOffTitle[drs.reason] };

/** MARGIN: PASS or HOLD with the pace margin per lap; a missing margin is unknown. */
function marginCell(margin: BattleSide['margin']): Cell {
  const cell: Cell = knownPart(margin ?? unknown('notReceived'), (m) => `${text.marginKind[m.kind]} ${formatSecondsPerLap(m.ms)}`);
  const role = marginRole(margin);
  return role === undefined ? cell : { ...cell, role };
}

const tyreText = (side: BattleSide): string => `${compoundText(side.ours.compound, side.ours.age)} ${compoundText(side.theirs.compound, side.theirs.age)}`;

function sideRow(label: BattleRow['label'], side: Side, card: BattleCard, cars: readonly CarOverview[], moment: Known<RaceMoment> | undefined): BattleRow {
  const known = card[side];
  if (!known.known) {
    const cells = Object.fromEntries(COLUMN_IDS.map((c) => [c, unknownPart(known.reason)])) as Record<ColumnId, Cell>;
    return { label, highlighted: false, cells };
  }
  const s = known.value;
  const highlight = battleRole(moment, card.carId, side);
  const cells: Record<ColumnId, Cell> = {
    drv: carCodeById(cars, s.carId),
    gap: knownPart(s.gapMs, (ms) => formatSignedSeconds(GAP_SIGN[side] * ms, 3)),
    toDrs: toDrsCell(s.lapsToDrs, card.drs),
    paceDelta: knownPart(s.paceDeltaMs, formatSecondsPerLap),
    margin: marginCell(s.margin),
    tyres: { text: tyreText(s) },
    ers: knownPart(s.theirErsStoreJ, formatJoules),
  };
  if (highlight !== undefined) for (const c of ['drv', 'gap', 'toDrs'] as const) cells[c] = { ...cells[c], role: highlight };
  return { label, highlighted: highlight !== undefined, cells, tyres: { ours: s.ours, theirs: s.theirs } };
}

/** The two rows of a card, AHEAD then BEHIND; the moment lights the side its battle cause names. */
export function battleRows(card: BattleCard, cars: readonly CarOverview[], moment: Known<RaceMoment> | undefined): BattleRow[] {
  return [sideRow(text.ahead, 'ahead', card, cars, moment), sideRow(text.behind, 'behind', card, cars, moment)];
}

const grid = (mode: WidgetSize['mode']): GridColumn[] => [{ width: LABEL_WIDTH }, ...columnsFor(mode).map((c) => WIDTH[c])];

/** The header line over the fixed fields. */
export const battleHeader = (mode: WidgetSize['mode']): string =>
  gridRow(grid(mode), ['', ...columnsFor(mode).map((c) => text.header[c])]);

/** A row as one line of fixed fields. */
export const battleRowText = (mode: WidgetSize['mode'], row: BattleRow): string =>
  gridRow(grid(mode), [row.label, ...columnsFor(mode).map((c) => row.cells[c].text)]);
