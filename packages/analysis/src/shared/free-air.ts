// Free-air laps (SP4.3a spec 5.1, 5.2; C43): the laps no car ran within a gap ahead of. One function, so
// `track-wetness` and `driver-noise` judge free air alike.
import type { MiniSectorCrossing, Ms } from '@pitwall/domain';
import type { DeepReadonly, Projection } from '@pitwall/engine/readers';

type Crossing = DeepReadonly<MiniSectorCrossing>;

/** A lap's mark, as bit flags: seen (one of its crossings is), held (a car within the gap ahead at one of them, bit 2). */
const SEEN = 1;
/** Seen and never held. */
const FREE = SEEN;

/** The time of "no crossing yet": so far before every crossing that no gap reaches it. */
const NEVER = -1e15;

/** The free-air laps: `isFree(car, lap)`, and `has('carId:lap')` by key. */
export type FreeAirLaps = {
  isFree(car: number, lap: number): boolean;
  has(key: string /* carId:lap */): boolean;
};

/** The marks per car and lap (`car * stride + lap`) as a `FreeAirLaps`. */
function freeAirOf(marks: Uint8Array, stride: number): FreeAirLaps {
  const isFree = (car: number, lap: number): boolean => lap >= 0 && lap < stride && car >= 0 && marks[car * stride + lap] === FREE;
  return {
    isFree,
    has: (key) => {
      const colon = key.indexOf(':');
      return colon > 0 && isFree(Number(key.slice(0, colon)), Number(key.slice(colon + 1)));
    },
  };
}

/**
 * Per boundary the newest crossing (car, time; car −1 is none) and the time of the newest crossing of another car than
 * it (`NEVER` without one).
 */
type Boundaries = { lastCar: Int32Array; lastAt: Float64Array; prevAt: Float64Array };

const boundaries = (count: number): Boundaries => ({
  lastCar: new Int32Array(count).fill(-1),
  lastAt: new Float64Array(count).fill(NEVER),
  prevAt: new Float64Array(count).fill(NEVER),
});

/**
 * Marks `crossings` (in race-clock order) into a table of `cars` × `stride` and `segments` boundaries; `false` (the
 * table is left partly marked) when a crossing lies outside them or out of order, so the caller sizes and sorts first.
 * The loop body has no branch on the data (whether the newest crossing is another car's, whether it is within the
 * gap): those are unpredictable, and selecting by arithmetic runs about twice as fast.
 */
function mark(crossings: readonly Crossing[], gapMs: Ms, marks: Uint8Array, stride: number, cars: number, b: Boundaries, checkOrder: boolean): boolean {
  const { lastCar, lastAt, prevAt } = b;
  const segments = lastCar.length;
  let previousAt = -Infinity;
  // an indexed loop: on the projection's long lists it runs faster than `for … of`
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i] as Crossing;
    const s = c.segment;
    const car: number = c.carId;
    const at = c.at;
    const lap = c.lap;
    if (checkOrder) {
      if (at < previousAt) return false;
      previousAt = at;
    }
    if (s < 0 || s >= segments || car < 0 || car >= cars || lap < 0 || lap >= stride) return false;
    // the newest crossing of another car: the newest one when it is another car's, else the one before it
    const la = lastAt[s] as number;
    const pa = prevAt[s] as number;
    const another = +((lastCar[s] as number) !== car);
    const aheadAt = pa + another * (la - pa);
    const held = +(aheadAt < at) & +(at - aheadAt < gapMs);
    const index = car * stride + lap;
    marks[index] = (marks[index] as number) | SEEN | (held << 1);
    prevAt[s] = aheadAt;
    lastCar[s] = car;
    lastAt[s] = at;
  }
  return true;
}

/** The table bounds of `crossings`: the largest car, lap and segment. */
function boundsOf(crossings: readonly Crossing[]): { cars: number; stride: number; segments: number } {
  let maxLap = 0;
  let maxCar = 0;
  let maxSegment = 0;
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i] as Crossing;
    if (c.lap > maxLap) maxLap = c.lap;
    if (c.carId > maxCar) maxCar = c.carId;
    if (c.segment > maxSegment) maxSegment = c.segment;
  }
  return { cars: maxCar + 1, stride: maxLap + 1, segments: maxSegment + 1 };
}

/** The guessed table bounds: the laps' largest car and lap (a car's next lap included), 50 boundaries. */
function guessedBounds(history: Projection): { cars: number; stride: number; segments: number } {
  let maxLap = 0;
  let maxCar = 0;
  const laps = history.laps;
  for (let i = 0; i < laps.length; i++) {
    const l = laps[i] as (typeof laps)[number];
    if (l.lapNumber > maxLap) maxLap = l.lapNumber;
    if (l.carId > maxCar) maxCar = l.carId;
  }
  return { cars: maxCar + 1, stride: maxLap + 3, segments: 64 };
}

/**
 * The laps (`carId:lap`) at none of whose crossings another car was within `gapMs` ahead: no other car crossed the same
 * mini-sector boundary less than `gapMs` earlier (any lap of its own, so a lapped car on the track counts). A lap
 * without crossings is not free air (nothing shows it was).
 *
 * One pass in race-clock order (the projection's append order; any other order is sorted first): per boundary it keeps
 * the newest crossing and the newest one of another car than that, so the newest crossing of any other car before each
 * crossing is one of the two. The table is sized from the laps; a crossing outside it, or out of order, falls back to
 * sizing it from the crossings (and sorting them).
 */
export function freeAirLaps(history: Projection, gapMs: Ms): FreeAirLaps {
  const crossings: readonly Crossing[] = history.crossings;
  const guess = guessedBounds(history);
  const marks = new Uint8Array(guess.cars * guess.stride);
  if (mark(crossings, gapMs, marks, guess.stride, guess.cars, boundaries(guess.segments), true)) return freeAirOf(marks, guess.stride);

  const bounds = boundsOf(crossings);
  let sorted = true;
  for (let i = 1; i < crossings.length && sorted; i++) if ((crossings[i] as Crossing).at < (crossings[i - 1] as Crossing).at) sorted = false;
  const ordered = sorted ? crossings : [...crossings].sort((a, b) => a.at - b.at);
  const all = new Uint8Array(bounds.cars * bounds.stride);
  mark(ordered, gapMs, all, bounds.stride, bounds.cars, boundaries(bounds.segments), false);
  return freeAirOf(all, bounds.stride);
}
