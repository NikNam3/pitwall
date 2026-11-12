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
  const superseded = new Set<number>();
  for (const c of list) if (c.supersedes !== undefined) superseded.add(c.supersedes.index);
  return list.filter((_, position) => !superseded.has(position));
}

/** The current crossings by car id, then lap number, then segment; slots may be empty. */
export type CrossingIndex = Map<CarId, Map<number, (MiniSectorCrossing | undefined)[]>>;

/**
 * The incremental form of `currentCrossings`: folds one crossing into `index`. After folding a list in order, `index`
 * holds exactly `currentCrossings(list)` by car, lap and segment. Mutates `index`.
 */
export function foldCurrentCrossing(index: CrossingIndex, crossing: MiniSectorCrossing): void {
  const byLap = index.get(crossing.carId) ?? new Map<number, (MiniSectorCrossing | undefined)[]>();
  index.set(crossing.carId, byLap);
  const slots = byLap.get(crossing.lap) ?? [];
  byLap.set(crossing.lap, slots);
  slots[crossing.segment] = crossing;
}

/**
 * The race-clock times (ms) of the current crossings of the chosen segments, in one pass over `list` under the rule
 * of `foldCurrentCrossing` (a later crossing of the same car, lap and segment supersedes). Cell
 * `(car * (laps + 1) + lap) * segments.length + k` holds car `car`, lap `lap`, segment `segments[k]`; `NaN` where
 * there is none. Crossings of a segment not chosen, or of a car or lap out of range, are ignored.
 */
export function currentCrossingTimes(list: readonly MiniSectorCrossing[], cars: number, laps: number, segments: readonly number[]): Float64Array {
  const chosen = segments.length;
  const times = new Float64Array(cars * (laps + 1) * chosen).fill(NaN);
  if (times.length === 0) return times;
  let maxSegment = -1;
  for (const s of segments) if (s > maxSegment) maxSegment = s;
  const slotOf = new Int32Array(maxSegment + 1).fill(-1);
  segments.forEach((s, k) => {
    if (s >= 0) slotOf[s] = k;
  });
  for (const c of list) {
    const car = c.carId as number;
    if (car < 0 || car >= cars || c.lap < 0 || c.lap > laps || c.segment < 0 || c.segment > maxSegment) continue;
    const k = slotOf[c.segment] as number;
    if (k < 0) continue;
    times[(car * (laps + 1) + c.lap) * chosen + k] = c.at;
  }
  return times;
}
