import type { CarId } from './ids.ts';
import type { LapRecord, MiniSectorCrossing } from './records.ts';

/** The current record of each lap: indexed by car id, then lap number. Slots may be sparse. */
export type CurrentLaps = Array<Record<number, LapRecord>>;

/** A collection with no laps. */
export function emptyCurrentLaps(): CurrentLaps {
  return [];
}

/**
 * Applies lap records in order. A confirmed record replaces anything; a provisional record never replaces a
 * confirmed one. Mutates and returns `current`.
 */
export function addLaps(current: CurrentLaps, laps: readonly LapRecord[]): CurrentLaps {
  for (const record of laps) {
    const byLap = (current[record.carId] ??= {});
    if (record.status === 'provisional' && byLap[record.lapNumber]?.status === 'confirmed') continue;
    byLap[record.lapNumber] = record;
  }
  return current;
}

/** The current record of every (car, lap), sorted by car id, then lap number. */
export function currentLaps(laps: readonly LapRecord[]): LapRecord[] {
  const result: LapRecord[] = [];
  for (const byLap of addLaps(emptyCurrentLaps(), laps)) {
    if (byLap === undefined) continue;
    const numbers = Object.keys(byLap).map(Number).sort((a, b) => a - b);
    for (const n of numbers) result.push(byLap[n] as LapRecord);
  }
  return result;
}

/** Every crossing no later crossing supersedes, in log order. */
export function currentCrossings(list: readonly MiniSectorCrossing[]): MiniSectorCrossing[] {
  void list;
  throw new Error('not implemented');
}

/** The current crossings by car id, then lap number, then segment; slots may be empty. */
export type CrossingIndex = Map<CarId, Map<number, (MiniSectorCrossing | undefined)[]>>;

/**
 * The incremental form of `currentCrossings`: folds one crossing into `index`. After folding a list in order, `index`
 * holds exactly `currentCrossings(list)` by car, lap and segment. Mutates `index`.
 */
export function foldCurrentCrossing(index: CrossingIndex, crossing: MiniSectorCrossing): void {
  void index;
  void crossing;
  throw new Error('not implemented');
}
