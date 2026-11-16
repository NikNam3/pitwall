// The strategy table's rows (SP4.3b spec §10; mockup strategy-table-b.html; Q1 A; P27). Every rank, tie, Δ and flag is
// the topic's (`strategy`, Task 6); the rows format and map them, they compute nothing (C65).
import type { McRow, Policy, StrategyCar } from '@pitwall/domain';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { formatCount, formatExpectedPlace, formatLapNumber, formatPoints, formatSignedSeconds } from '../../kit/values/format.ts';
import type { Role } from '../../theme/index.ts';
import * as text from './text.ts';

/** The strategy table's value for one car (the known part of `StrategyCar`). */
export type PlanTable = Extract<StrategyCar, { known: true }>['value'];

/** A text with its hover and role (no role: the line's). */
export type Cell = { text: string; hover?: string; role?: Role };
/** The tie bracket of a row: whether it starts or ends its group, its role (`warning` while unresolved), its hover. */
export type Bracket = { first: boolean; last: boolean; role: Role; hover: string };
/** One row of the list beside the chart. */
export type ListRow = { bracket: Bracket | null; rank: string; source: Cell; stops: string; ePos: string; committed: boolean; infeasible: string | null };
/** The info row of a highlighted policy. */
export type InfoRow = {
  rank: string;
  source: Cell;
  stops: string;
  ePos: string;
  ePoints: string;
  delta: string;
  button: 'commit' | 'clear';
};

/** Each stop `L20 H`, joined by a space; a policy with no stops reads `to the flag`. */
export const stopsText = (policy: Policy): string =>
  policy.stops.length === 0
    ? text.toTheFlag
    : policy.stops.map((s) => `${formatLapNumber(s.lap, 2)} ${COMPOUND_MARK[s.compound].letter}`).join(' ');

/** A row's source word with its hover; a rule candidate's hover names its rule. */
function sourceCell(row: McRow): Cell {
  if (row.source === 'rule') return { text: text.source.rule, hover: row.rule === null ? text.sourceHover.dp : text.sourceHover.rule(row.rule) };
  return { text: text.source[row.source], hover: text.sourceHover[row.source] };
}

function bracketOf(plan: PlanTable, i: number): Bracket | null {
  const rows = plan.rows;
  if (rows[i]?.tie !== true) return null;
  return {
    first: rows[i - 1]?.tie !== true,
    last: rows[i + 1]?.tie !== true,
    role: plan.unresolvedTie ? 'warning' : 'textDim',
    hover: plan.unresolvedTie ? text.openTieHover : text.tieHover,
  };
}

export const listRows = (plan: PlanTable): ListRow[] =>
  plan.rows.map((row, i) => ({
    bracket: bracketOf(plan, i),
    rank: String(row.rank),
    source: sourceCell(row),
    stops: stopsText(row.policy),
    ePos: formatExpectedPlace(row.ePos),
    committed: row.committed,
    infeasible: row.infeasible === null ? null : text.infeasible[row.infeasible],
  }));

const hasCommit = (plan: PlanTable): boolean => plan.rows.some((r) => r.committed);

/** ΔTIME against the leader without a commit (blank on rows[0]); ΔPLAN against the committed row with one (blank on it). */
function deltaOf(plan: PlanTable, i: number, row: McRow): string {
  if (hasCommit(plan)) return row.committed || row.deltaPlanMs === null ? '' : formatSignedSeconds(row.deltaPlanMs, 1);
  return i === 0 ? '' : formatSignedSeconds(row.deltaLeaderMs, 1);
}

export function infoRow(plan: PlanTable, i: number): InfoRow {
  const row = plan.rows[i];
  if (row === undefined) throw new Error(`strategy-table: no row ${i}`);
  return {
    rank: String(row.rank),
    source: sourceCell(row),
    stops: stopsText(row.policy),
    ePos: formatExpectedPlace(row.ePos),
    ePoints: formatPoints(row.ePoints),
    delta: deltaOf(plan, i, row),
    button: row.committed ? 'clear' : 'commit',
  };
}

export const deltaHeader = (plan: PlanTable): string => (hasCommit(plan) ? text.headers.dPlan : text.headers.dLead);

export function footer(plan: PlanTable): { n: Cell; cand: string } {
  const count = formatCount(plan.scenarios);
  return {
    n: plan.unresolvedTie ? { text: count, role: 'warning', hover: text.openTieHover } : { text: count },
    cand: formatCount(plan.candidates),
  };
}
