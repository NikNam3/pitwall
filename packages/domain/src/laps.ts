import type { LapRecord } from './records.ts';

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
