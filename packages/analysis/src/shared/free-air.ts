// Free-air laps (SP4.3a spec 5.1, 5.2; C43): the laps no car ran within a gap ahead of. One function, so
// `track-wetness` and `driver-noise` judge free air alike.
import type { MiniSectorCrossing, Ms } from '@pitwall/domain';
import type { DeepReadonly, Projection } from '@pitwall/engine/readers';

type Crossing = DeepReadonly<MiniSectorCrossing>;

/** A lap's mark: not seen, seen with no car close ahead, or held (a car within the gap ahead at one of its crossings). */
const UNSEEN = 0;
const FREE = 1;
const HELD = 2;

/**
 * The laps (`carId:lap`) at none of whose crossings another car was within `gapMs` ahead: no other car crossed the same
 * mini-sector boundary less than `gapMs` earlier (any lap of its own, so a lapped car on the track counts). A lap
 * without crossings is not free air (nothing shows it was).
 *
 * One pass in race-clock order (the projection's append order; any other order is sorted first): per boundary it keeps
 * the newest crossing and the newest one of another car than that, so the newest crossing of any other car before each
 * crossing is one of the two.
 */
export function freeAirLaps(history: Projection, gapMs: Ms): ReadonlySet<string /* carId:lap */> {
  let crossings: readonly Crossing[] = history.crossings;
  let maxLap = 0;
  let maxCar = 0;
  let maxSegment = 0;
  let sorted = true;
  let previousAt = -Infinity;
  for (const c of crossings) {
    if (c.lap > maxLap) maxLap = c.lap;
    if (c.carId > maxCar) maxCar = c.carId;
    if (c.segment > maxSegment) maxSegment = c.segment;
    if (c.at < previousAt) sorted = false;
    previousAt = c.at;
  }
  if (!sorted) crossings = [...crossings].sort((a, b) => a.at - b.at);

  const stride = maxLap + 1;
  const marks = new Uint8Array((maxCar + 1) * stride);
  // per boundary: the newest crossing (car, time) and the newest of another car than it; car −1 is none
  const lastCar = new Int32Array(maxSegment + 1).fill(-1);
  const lastAt = new Float64Array(maxSegment + 1);
  const prevCar = new Int32Array(maxSegment + 1).fill(-1);
  const prevAt = new Float64Array(maxSegment + 1);
  for (const c of crossings) {
    const s = c.segment;
    const car: number = c.carId;
    const at = c.at;
    const lc = lastCar[s] as number;
    const other = lc !== car ? lc : (prevCar[s] as number);
    const aheadAt = (lc !== car ? lastAt[s] : prevAt[s]) as number;
    const index = car * stride + c.lap;
    if (other >= 0 && aheadAt < at && at - aheadAt < gapMs) marks[index] = HELD;
    else if (marks[index] === UNSEEN) marks[index] = FREE;
    if (lc !== car) {
      prevCar[s] = lc;
      prevAt[s] = lastAt[s] as number;
    }
    lastCar[s] = car;
    lastAt[s] = at;
  }

  const free = new Set<string>();
  for (let car = 0; car <= maxCar; car++) for (let lap = 0; lap < stride; lap++) if (marks[car * stride + lap] === FREE) free.add(`${car}:${lap}`);
  return free;
}
