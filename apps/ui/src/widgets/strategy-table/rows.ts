// STUB (test phase, SP4.3b2 Task 12): the shape the tests assume of the strategy table's rows; every function throws
// `not implemented` until the implement phase writes it. The rows format and map the topic, they compute nothing (C65).
import type { Policy, StrategyCar, Trigger } from '@pitwall/domain';
import type { Role } from '../../theme/index.ts';

const notImplemented = (): never => {
  throw new Error('not implemented');
};

/** The strategy table's value for one car (the known part of `StrategyCar`). */
export type PlanTable = Extract<StrategyCar, { known: true }>['value'];

/** A text with its hover and role (no role: the line's). */
export type Cell = { text: string; hover?: string; role?: Role };
/** The tie bracket of a row: whether it starts or ends its group, its role (`warning` while unresolved), its hover. */
export type Bracket = { first: boolean; last: boolean; role: Role; hover: string };
/** One row of the list beside the chart. */
export type ListRow = { bracket: Bracket | null; rank: string; source: Cell; stops: string; ePos: string; committed: boolean; infeasible: string | null };
/** The info row of a highlighted policy, then its triggers. */
export type InfoRow = {
  rank: string;
  source: Cell;
  stops: string;
  trg: string;
  ePos: string;
  ePoints: string;
  delta: string;
  button: 'commit' | 'clear';
  triggers: string[];
};

export const stopsText = (_policy: Policy): string => notImplemented();
export const listRows = (_plan: PlanTable): ListRow[] => notImplemented();
export const infoRow = (_plan: PlanTable, _i: number): InfoRow => notImplemented();
export const deltaHeader = (_plan: PlanTable): string => notImplemented();
export const footer = (_plan: PlanTable): { n: Cell; cand: string } => notImplemented();
export const triggerTexts = (_triggers: readonly Trigger[]): string[] => notImplemented();
