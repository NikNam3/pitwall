// The one widget-level state a panel header shows (spec 4.3, Task 0 frame B), decided the same way for every widget.
import type { Role } from '../../theme/index.ts';
import * as text from '../../kit/text.ts';

/** Where the panel's data stands: every required topic `ok`, one `errored`, or still waiting (also `noData`). */
export type DataStatus = 'ok' | 'waiting' | 'errored';

/** What the header knows about the panel. */
export type HeaderFacts = {
  /** False for an unknown widget: its body says so and the header shows no state. */
  known: boolean;
  data: DataStatus;
  /** The link to the bridge is down, or the feed reports `stale`: values may be old. */
  feedStale: boolean;
  /** How long the most behind value cell has been stale (panel context, spec 6.4). */
  staleForMs: number | undefined;
  /** The laps the panel's `Computed` values were computed for. */
  computedLaps: readonly number[];
};

/** The header's state text and its colour role, or undefined for none. */
export type HeaderState = { text: string; role: Role } | undefined;

const MS_PER_S = 1000;

/** Errors first, then missing data, then staleness, then the age of a computed result. */
export function headerState(f: HeaderFacts): HeaderState {
  if (!f.known) return undefined;
  if (f.data === 'errored') return { text: text.errored, role: 'critical' };
  if (f.data === 'waiting') return { text: text.noDataYet, role: 'textFaint' };
  if (f.staleForMs !== undefined) return { text: text.stale(Math.floor(f.staleForMs / MS_PER_S)), role: 'warning' };
  if (f.feedStale) return { text: text.stale(), role: 'warning' };
  if (f.computedLaps.length > 0) return { text: text.computedFor(Math.min(...f.computedLaps)), role: 'textDim' };
  return undefined;
}

/** The lap a topic value was computed for, when it is a `Computed` result (value plus `computedFor`). */
export function computedLap(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('computedFor' in value)) return undefined;
  const lap = (value.computedFor as { lap?: unknown } | null)?.lap;
  return typeof lap === 'number' ? lap : undefined;
}
