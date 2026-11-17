// The plan board's lines (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html). Every E[pos],
// SE, ΔPOS, ΔTIME, rank and DP pick is the topic's (`strategy`, Task 5); the lines select and format them, they compute
// nothing (C65). SP4.3d2 Task 12: a prefilled slot (the topic's `prefill`, not yet saved) is a line of its own, its
// cells those of the topic's row with its plan; each line carries its plan's start compound letter (the START column).
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
/** A slot the strategy job may prefill (SP4.3d spec §7.1 step 5). */
export type PrefillSlot = keyof BoardTable['prefill'];

/** The cells a slot line and a DP line share; `start` the start compound's letter, empty when the plan names none. */
type Cells = { stops: string; start: string; ePos: string; dPos: string; dPosRole: Role | undefined; dTime: string; pmf: readonly number[]; policy: Policy };
/** `prefill`: the line is the topic's prefill of its slot, not a saved plan (dim, with `accept`). */
export type SlotLine = Cells & { key: Slot | 'active'; slot: Slot | null; label: string; active: boolean; faint: boolean; prefill: boolean; hover: string | undefined };
export type DpLine = Cells & { stopCount: StopCount; same: Slot | null };
export type BoardView = { slots: SlotLine[]; dp: DpLine[]; scale: number; ourPlace: number };

const STOP_COUNTS: readonly StopCount[] = [0, 1, 2, 3];
/** Compact shows the DP's 1- and 2-stop only, and three slot lines at most (mockup gen.mjs `bCompact`). */
const COMPACT_STOP_COUNTS: readonly StopCount[] = [1, 2];
const COMPACT_SLOTS = 3;
const PREFILL_SLOTS: readonly PrefillSlot[] = ['A', 'B'];

/** Each stop `L22 H`, joined by ` · `; a plan with no stop reads `no stop`. */
export const stopsText = (policy: Policy): string =>
  policy.stops.length === 0 ? text.noStop : policy.stops.map((s) => `${formatLapNumber(s.lap, 2)} ${COMPOUND_MARK[s.compound].letter}`).join(text.stopJoin);

/** The START cell: the plan's start compound letter; empty when it names none (the race). */
export const startText = (policy: Policy): string => (policy.startCompound === undefined ? '' : COMPOUND_MARK[policy.startCompound].letter);

/** Two plans are the same plan: the same start compound and the same stops. */
export const samePolicy = (a: Policy, b: Policy): boolean =>
  a.startCompound === b.startCompound && a.stops.length === b.stops.length && a.stops.every((s, i) => s.lap === b.stops[i]?.lap && s.compound === b.stops[i]?.compound);

function cellsOf(row: McRow): Cells {
  const dPos = row.diffPlan;
  return {
    stops: stopsText(row.policy),
    start: startText(row.policy),
    ePos: formatExpectedPlaceSe(row.ePos, row.se),
    dPos: dPos.known ? formatPlacesGained(dPos.value, 2) : '',
    dPosRole: dPos.known ? deltaRole(dPos.value) : undefined,
    dTime: row.committed || row.deltaPlanMs === null ? '' : formatSignedSeconds(row.deltaPlanMs, 1),
    pmf: row.positionPmf,
    policy: row.policy,
  };
}

/** A plan without a row of its own: its stops and start, every number empty. */
const bareCells = (policy: Policy): Cells => ({ stops: stopsText(policy), start: startText(policy), ePos: '', dPos: '', dPosRole: undefined, dTime: '', pmf: [], policy });

function slotLine(row: McRow): SlotLine {
  const label = row.slot === null ? text.active : `${row.slot}${row.committed ? text.active : ''}`;
  return {
    ...cellsOf(row),
    key: row.slot ?? 'active',
    slot: row.slot,
    label,
    active: row.committed,
    faint: row.infeasible !== null,
    prefill: false,
    hover: row.infeasible === null ? undefined : text.infeasible[row.infeasible],
  };
}

/** The prefilled slots without a saved plan: the slot and its plan. */
function prefills(value: BoardTable): { slot: PrefillSlot; policy: Policy }[] {
  return PREFILL_SLOTS.flatMap((slot) => {
    const policy = value.prefill[slot];
    return policy === undefined || value.rows.some((r) => r.slot === slot) ? [] : [{ slot, policy }];
  });
}

/** A prefill's line: the cells of the topic's row with its plan (the DP's), no `●` (nothing saved yet). */
function prefillLine(value: BoardTable, slot: PrefillSlot, policy: Policy): SlotLine {
  const row = value.rows.find((r) => samePolicy(r.policy, policy));
  const cells = row === undefined ? bareCells(policy) : cellsOf(row);
  return { ...cells, policy, key: slot, slot, label: slot, active: false, faint: false, prefill: true, hover: text.prefillHover };
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

/** The slot lines with the prefilled ones, in slot order (a loose active line first); compact three at most. */
function slotLines(value: BoardTable, compact: boolean): SlotLine[] {
  const saved = slotRows(value, compact).map(slotLine);
  const room = compact ? Math.max(0, COMPACT_SLOTS - saved.length) : PREFILL_SLOTS.length;
  const filled = prefills(value)
    .slice(0, room)
    .map((p) => prefillLine(value, p.slot, p.policy));
  const order = (l: SlotLine): number => (l.slot === null ? -1 : PLAN_SLOTS.indexOf(l.slot));
  return [...saved, ...filled].sort((a, b) => order(a) - order(b));
}

/** The slot a DP pick equals: its row's slot, else the prefilled slot with its plan. */
function sameSlot(value: BoardTable, row: McRow): Slot | null {
  return row.slot ?? prefills(value).find((p) => samePolicy(p.policy, row.policy))?.slot ?? null;
}

export function boardRows(value: BoardTable, mode: 'full' | 'compact'): BoardView {
  const compact = mode === 'compact';
  const slots = slotLines(value, compact);
  const dp = (compact ? COMPACT_STOP_COUNTS : STOP_COUNTS).flatMap((n): DpLine[] => {
    const index = value.bestPerStops[n];
    const row = index === undefined ? undefined : value.rows[index];
    return row === undefined ? [] : [{ ...cellsOf(row), stopCount: n, same: sameSlot(value, row) }];
  });
  const pmfs = [...slots, ...dp].map((l) => l.pmf).filter((p) => p.length > 0);
  return { slots, dp, scale: sharedScale(pmfs), ourPlace: value.currentPosition };
}

/** The first slot (in `PLAN_SLOTS` order) that holds no plan; `undefined` when every slot is taken ("save as"). */
export const freeSlot = (value: BoardTable): Slot | undefined => PLAN_SLOTS.find((s) => !value.rows.some((r) => r.slot === s));
