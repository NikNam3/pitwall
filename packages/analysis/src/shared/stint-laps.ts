// A car's laps and those of its current stint, one record per lap: the one rule for the analyses that rate or average them.
import { currentLaps, type CarId, type LapRecord, type StintRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';

type History = Pick<EngineView['history'], 'laps' | 'stints'>;

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
 * The car's laps, one record per lap (confirmed over provisional, as the domain's `currentLaps`), sorted by lap number.
 * The records are the view's, to be read only.
 */
export function carLaps(history: Pick<History, 'laps'>, carId: CarId): LapRecord[] {
  // the view is deep-readonly; the records are only read
  return currentLaps((history.laps as readonly LapRecord[]).filter((l) => l.carId === carId));
}

/** Every car's laps, each as `carLaps` gives them, from one pass over the history's laps (a reader of many cars). */
export function lapsByCar(history: Pick<History, 'laps'>): ReadonlyMap<CarId, LapRecord[]> {
  const byCar = new Map<CarId, LapRecord[]>();
  // `currentLaps` sorts by car id, then lap number: each car's list comes out sorted by lap number
  for (const l of currentLaps(history.laps as readonly LapRecord[])) {
    const own = byCar.get(l.carId);
    if (own === undefined) byCar.set(l.carId, [l]);
    else own.push(l);
  }
  return byCar;
}

/** The car's laps of its current stint (`stintLaps`), as `carLaps` gives them; `laps`, when given, are its `carLaps`. */
export function currentStintLaps(history: History, carId: CarId, laps: readonly LapRecord[] = carLaps(history, carId)): LapRecord[] {
  const last = history.stints.findLast((s) => s.carId === carId);
  return stintLaps(laps, last);
}
