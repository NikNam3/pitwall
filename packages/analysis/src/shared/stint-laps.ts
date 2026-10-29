// The laps of a car's current stint, one record per lap: the one rule for the analyses that rate or average a stint.
import { currentLaps, type CarId, type LapRecord, type StintRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';

type History = Pick<EngineView['state']['history'], 'laps' | 'stints'>;

/**
 * The laps of the current stint among one car's laps. `history.stints` holds closed stints only (the engine writes a
 * record when a stint ends): the open stint starts after the car's last record, unless that record reaches the newest
 * lap (the session ended, or a stop whose in lap has not yet been followed by a completed lap), which makes it the
 * current stint. Without a record the whole history is one stint. Keeps the order of `carLaps`.
 */
export function stintLaps<L extends { lapNumber: number }>(
  carLaps: readonly L[],
  lastStint: Pick<StintRecord, 'firstLap' | 'lastLap'> | undefined,
): L[] {
  if (lastStint === undefined) return [...carLaps];
  const newest = carLaps.reduce((n, l) => Math.max(n, l.lapNumber), 0);
  const first = lastStint.lastLap >= newest ? lastStint.firstLap : lastStint.lastLap + 1;
  return carLaps.filter((l) => l.lapNumber >= first);
}

/**
 * The car's laps of its current stint (`stintLaps`), one record per lap (confirmed over provisional, as the domain's
 * `currentLaps`), sorted by lap number. The records are the view's, to be read only.
 */
export function currentStintLaps(history: History, carId: CarId): LapRecord[] {
  // the view is deep-readonly; the records are only read
  const own = currentLaps((history.laps as readonly LapRecord[]).filter((l) => l.carId === carId));
  const last = history.stints.filter((s) => s.carId === carId).at(-1);
  return stintLaps(own, last);
}
