import type { SessionTime } from '@pitwall/domain';
import type { EngineState } from '../state/engine-state.ts';

/** Keeps the entries of `list` that pass `keep`, in order, in the same array. */
const keepWhere = <T>(list: T[], keep: (entry: T) => boolean): void => {
  let kept = 0;
  for (const entry of list) if (keep(entry)) list[kept++] = entry;
  list.length = kept;
};

/**
 * What a clock reset (the game sets the session time back to `at` without a flashback, as at the end of the formation
 * lap) leaves of the history: every entry stamped at or before `at`. A stint carries no stamp; it stays while the
 * record of its last lap does. The open trackers that carry session times (lap and mini-sector cursors, pit visits,
 * the open flag phase) span the jump of the clock and are dropped, so the next frame starts them over as on a car's
 * first frame. The cars and the trackers without a session time (open stints, pit status, damage) stay.
 */
export function dropRecordedAfter(state: EngineState, at: SessionTime): void {
  const { history, open } = state;
  keepWhere(history.laps, (lap) => lap.completedAt <= at);
  keepWhere(history.pitStops, (stop) => stop.pitLaneExit <= at);
  keepWhere(history.flagPhases, (phase) => phase.end <= at);
  keepWhere(history.events, (event) => event.at <= at);
  keepWhere(history.miniSectors, (crossing) => crossing.at <= at);
  open.lapIndex = open.lapIndex.map(() => ({}));
  history.laps.forEach((lap, i) => {
    const index = open.lapIndex[lap.carId];
    if (!index) return;
    const slot = (index[lap.lapNumber] ??= { confirmed: false });
    if (lap.status === 'confirmed') slot.confirmed = true;
    else slot.provisional = i;
  });
  keepWhere(history.stints, (stint) => open.lapIndex[stint.carId]?.[stint.lastLap] !== undefined);
  open.laps.fill(undefined);
  open.miniSectors.fill(undefined);
  open.pitVisits.fill(undefined);
  open.flagPhase = undefined;
}
