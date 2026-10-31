import type { History, HistoryLengths } from '../state/engine-state.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/**
 * What one step added to the append-only history: the list lengths before and after it. `truncated` marks a step that
 * changed what was recorded before it (a flashback, lights out discarding the formation lap, the start's settling) or
 * how a reader must read it (a dropped neutralisation; any session phase opening or closing at a moment earlier frames
 * share, e.g. the race start on the grid's standing clock), so a reader must start from 0 instead of `before`.
 */
export type HistoryDelta = { before: HistoryLengths; after: HistoryLengths; truncated: boolean };

/** The length of every history list. */
export const historyLengths = (h: DeepReadonly<History>): HistoryLengths => ({
  laps: h.laps.length,
  stints: h.stints.length,
  pitStops: h.pitStops.length,
  flagPhases: h.flagPhases.length,
  sessionPhases: h.sessionPhases.length,
  pauses: h.pauses.length,
  events: h.events.length,
  miniSectors: h.miniSectors.length,
});

/** Cuts every history list back to its length in `to`; a list that is already that short stays as it is. */
export function truncateHistory(h: History, to: HistoryLengths): void {
  for (const key of Object.keys(to) as Array<keyof History>) h[key].splice(to[key]);
}
