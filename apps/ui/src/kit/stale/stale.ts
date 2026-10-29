import { SOURCE_INTERVAL_MS, type CarState, type DataSource, type SessionTime } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { CAR_FIELD_SOURCE, type CarFieldPath } from '../values/car-sources.ts';

/** The session clock a panel reads to judge staleness; the shell passes the store's. */
export type PanelClock = { now(): SessionTime | undefined; cadenceMs(): number | undefined };

/** Missed updates after which a value counts as stale (spec 6.4). */
export const STALE_FACTOR = 3;

/**
 * Whether a source has fallen behind: its last update is older than `factor` expected intervals.
 * Menu-rate sources use the measured `cadenceMs`; without one, or without any update yet, nothing is stale.
 */
export function isStale(
  updatedAt: SessionTime | undefined,
  source: DataSource,
  now: SessionTime,
  cadenceMs: number | undefined,
  factor = STALE_FACTOR,
): boolean {
  if (updatedAt === undefined) return false;
  const interval = SOURCE_INTERVAL_MS[source];
  const expected = interval === 'menuRate' ? cadenceMs : interval;
  if (expected === undefined) return false;
  return now - updatedAt > factor * expected;
}

/**
 * How long a car field has been behind, in ms: its source's age once `isStale` says so (spec 6.4). Undefined while it
 * is fresh, before its source first arrived, and without a panel clock or a `CarState.updatedAt`.
 */
export function carFieldStaleMs(updatedAt: CarState['updatedAt'] | undefined, field: CarFieldPath, clock: PanelClock | undefined): number | undefined {
  const now = clock?.now();
  const source = CAR_FIELD_SOURCE[field];
  const at = updatedAt?.[source];
  if (now === undefined || at === undefined || !isStale(at, source, now, clock?.cadenceMs())) return undefined;
  return now - at;
}

/** The colour role of a value that may be stale: stale wins over every highlight, so an old value never stays amber or red. */
export const staleRole = (role: Role | undefined, stale: boolean): Role | undefined => (stale ? 'textFaint' : role);
