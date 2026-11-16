// The plan board's lines (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html). Every E[pos],
// SE, ΔPOS, ΔTIME, rank and DP pick is the topic's (`strategy`, Task 5); the lines select and format them, they compute
// nothing (C65).
import { PLAN_SLOTS, type McRow, type Policy, type Slot, type StrategyCar } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { sharedScale } from '../../kit/dist/dist.ts';
import { formatExpectedPlaceSe, formatLapNumber, formatPlacesGained, formatSignedSeconds } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { deltaRole } from './emphasis.ts';
import * as text from './text.ts';

/** The board's value for one car (the known part of `StrategyCar`). */
export type BoardTable = Extract<StrategyCar, { known: true }>['value'];
export type StopCount = 0 | 1 | 2 | 3;

/** The cells a slot line and a DP line share. */
type Cells = { stops: string; ePos: string; dPos: string; dPosRole: Role | undefined; dTime: string; pmf: readonly number[]; policy: Policy };
export type SlotLine = Cells & { key: Slot | 'active'; slot: Slot | null; label: string; active: boolean; faint: boolean; hover: string | undefined };
export type DpLine = Cells & { stopCount: StopCount; same: Slot | null };
export type BoardView = { slots: SlotLine[]; dp: DpLine[]; scale: number; ourPlace: number };

const STOP_COUNTS: readonly StopCount[] = [0, 1, 2, 3];
/** Compact shows the DP's 1- and 2-stop only, and three slot lines at most (mockup gen.mjs `bCompact`). */
const COMPACT_STOP_COUNTS: readonly StopCount[] = [1, 2];
const COMPACT_SLOTS = 3;

/** Each stop `L22 H`, joined by ` · `; a plan with no stop reads `no stop`. */
export const stopsText = (policy: Policy): string =>
  policy.stops.length === 0 ? text.noStop : policy.stops.map((s) => `${formatLapNumber(s.lap, 2)} ${COMPOUND_MARK[s.compound].letter}`).join(text.stopJoin);

function cellsOf(row: McRow): Cells {
  const dPos = row.diffPlan;
  return {
    stops: stopsText(row.policy),
    ePos: formatExpectedPlaceSe(row.ePos, row.se),
    dPos: dPos.known ? formatPlacesGained(dPos.value, 2) : '',
    dPosRole: dPos.known ? deltaRole(dPos.value) : undefined,
    dTime: row.committed || row.deltaPlanMs === null ? '' : formatSignedSeconds(row.deltaPlanMs, 1),
    pmf: row.positionPmf,
    policy: row.policy,
  };
}

function slotLine(row: McRow): SlotLine {
  const label = row.slot === null ? text.active : `${row.slot}${row.committed ? text.active : ''}`;
  return {
    ...cellsOf(row),
    key: row.slot ?? 'active',
    slot: row.slot,
    label,
    active: row.committed,
    faint: row.infeasible !== null,
    hover: row.infeasible === null ? undefined : text.infeasible[row.infeasible],
  };
}

/** The slot rows in `PLAN_SLOTS` order, an active row in no slot first; compact the active one and the best-ranked others. */
function slotRows(value: BoardTable, compact: boolean): McRow[] {
  const loose = value.rows.filter((r) => r.slot === null && r.committed);
  const bySlot = PLAN_SLOTS.flatMap((s) => value.rows.filter((r) => r.slot === s));
  const all = [...loose, ...bySlot];
  if (!compact) return all;
  const activeRows = all.filter((r) => r.committed);
  // the topic's row order is its rank
  const others = value.rows.filter((r) => r.slot !== null && !r.committed).slice(0, Math.max(0, COMPACT_SLOTS - activeRows.length));
  return all.filter((r) => activeRows.includes(r) || others.includes(r));
}

export function boardRows(value: BoardTable, mode: 'full' | 'compact'): BoardView {
  const compact = mode === 'compact';
  const slots = slotRows(value, compact).map(slotLine);
  const dp = (compact ? COMPACT_STOP_COUNTS : STOP_COUNTS).flatMap((n): DpLine[] => {
    const index = value.bestPerStops[n];
    const row = index === undefined ? undefined : value.rows[index];
    return row === undefined ? [] : [{ ...cellsOf(row), stopCount: n, same: row.slot }];
  });
  return { slots, dp, scale: sharedScale([...slots, ...dp].map((l) => l.pmf)), ourPlace: value.currentPosition };
}

/** The first slot (in `PLAN_SLOTS` order) that holds no plan; `undefined` when every slot is taken ("save as"). */
export const freeSlot = (value: BoardTable): Slot | undefined => PLAN_SLOTS.find((s) => !value.rows.some((r) => r.slot === s));
