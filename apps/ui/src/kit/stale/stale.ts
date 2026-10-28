import { SOURCE_INTERVAL_MS, type DataSource, type SessionTime } from '@pitwall/domain';

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
