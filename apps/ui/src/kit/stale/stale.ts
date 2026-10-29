import { SOURCE_INTERVAL_MS, type CarState, type DataSource, type SessionTime } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';
import { CAR_FIELD_SOURCE, type CarFieldPath } from '../values/car-sources.ts';

/** What a panel knows of its feed to judge staleness: the measured cadence of the menu-rate sources (`feed.status`). */
export type PanelFeed = { cadenceMs(): number | undefined };

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

/** The car's newest update over all its sources: the moment its snapshot stands for. */
function newestOf(updatedAt: CarState['updatedAt']): SessionTime | undefined {
  let newest: SessionTime | undefined;
  for (const at of Object.values(updatedAt)) if (newest === undefined || at > newest) newest = at;
  return newest;
}

/**
 * How long a car field has been behind, in ms: how much older its source's update is than the car's newest update, once
 * `isStale` says so (spec 6.4). The car snapshot is its own reference: a session clock from another topic arrives at other
 * moments (topics are throttled apart, the more so at replay speed) and made fresh fields stale for a frame. A car whose
 * every source stops is the feed's staleness, not a field's. Undefined while fresh, before its source first arrived, and
 * without `updatedAt`.
 */
export function carFieldStaleMs(updatedAt: CarState['updatedAt'] | undefined, field: CarFieldPath, cadenceMs: number | undefined): number | undefined {
  const source = CAR_FIELD_SOURCE[field];
  const at = updatedAt?.[source];
  const now = updatedAt === undefined ? undefined : newestOf(updatedAt);
  if (at === undefined || now === undefined || !isStale(at, source, now, cadenceMs)) return undefined;
  return now - at;
}

/** The colour role of a value that may be stale: stale wins over every highlight, so an old value never stays amber or red. */
export const staleRole = (role: Role | undefined, stale: boolean): Role | undefined => (stale ? 'textFaint' : role);
