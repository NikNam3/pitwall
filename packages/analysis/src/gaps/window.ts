// The gapper's window (live polish spec 3.2): which cars the gapper draws around ours, a fold over the crossings
// (C31.2). The accumulator cannot know our cars (they are live state), so it keeps the window of every set of one or two
// cars that could be ours, and the output picks the set of our cars (`ourCars`).
import { MAX_CARS, type CarId, type Ms, type SessionTime } from '@pitwall/domain';

/** `MAX_CARS` as a module constant: the hot loops below read it once per step, not through the import binding. */
const CARS: number = MAX_CARS;

/** How far apart two cars are for the window: within `windowMs`, up to `windowMs + windowExitMs`, or beyond. */
const NEAR = 0;
const EDGE = 1;
const FAR = 2;
type Zone = typeof NEAR | typeof EDGE | typeof FAR;

/**
 * Per pair of cars, how far apart they were at the newest point both passed, judged at the crossing that made it
 * common; per set of one or two cars (the cars that may be ours), the cars in its window. A car enters a set's window
 * within `windowMs` of one car of the set and leaves it only beyond `windowMs + windowExitMs` of every one: its state
 * changes only when the nearer of its pairs with the set's cars changes zone.
 */
export type GapperWindow = {
  /** By `pairOf(a, b)`: the zone of the newest gap between `a` and `b`; far while they share no point. */
  zones: Uint8Array;
  /** By `pairOf(x, y) × MAX_CARS + car`: 1 when `car` is in the window of the set `{x, y}` (`x = y`: of `x` alone). */
  inside: Uint8Array;
};

/** The window's thresholds (`GAPS_CONFIG`): a car enters within `nearMs` and leaves beyond `farMs`. */
export type WindowThresholds = { nearMs: Ms; farMs: Ms };

export const windowThresholds = ({ windowMs, windowExitMs }: { windowMs: Ms; windowExitMs: Ms }): WindowThresholds => ({
  nearMs: windowMs,
  farMs: windowMs + windowExitMs,
});

export const emptyWindow = (): GapperWindow => ({ zones: new Uint8Array(CARS * CARS).fill(FAR), inside: new Uint8Array(CARS ** 3) });

/** The index of the unordered pair or set `{a, b}`. */
const pairOf = (a: CarId, b: CarId): number => (a < b ? a * CARS + b : b * CARS + a);

const zoneOf = (w: GapperWindow, a: CarId, b: CarId): Zone => w.zones[pairOf(a, b)] as Zone;

/** Judges `car` in the window of every set that holds `anchor` (and not `car`), on its nearer pair with the set's cars. */
function judgeAround(w: GapperWindow, car: CarId, anchor: CarId): void {
  for (let i = 0; i < CARS; i++) {
    const other = i as CarId;
    if (other === car) continue;
    const nearest = Math.min(zoneOf(w, car, anchor), zoneOf(w, car, other));
    const at = pairOf(anchor, other) * CARS + car;
    if (nearest === NEAR) w.inside[at] = 1;
    else if (nearest === FAR) w.inside[at] = 0;
  }
}

/**
 * Every car's crossing times by progress in one dense array (`progress × MAX_CARS + car`, `NaN` where the car has no
 * crossing), so judging a crossing reads one row of `MAX_CARS` cells. Grown by doubling.
 */
export type CrossingTimes = { at: Float64Array };

export const emptyCrossingTimes = (): CrossingTimes => ({ at: new Float64Array(64 * CARS).fill(NaN) });

/** Sets `car`'s time at `progress` (`NaN`: none). */
export function setCrossingTime(times: CrossingTimes, car: CarId, progress: number, at: number): void {
  const cell = progress * CARS + car;
  if (cell >= times.at.length) {
    let size = times.at.length * 2;
    while (cell >= size) size *= 2;
    const grown = new Float64Array(size).fill(NaN);
    grown.set(times.at);
    times.at = grown;
  }
  times.at[cell] = at;
}

/** Clears `car`'s times from `from` up to, not including, `to`. */
export function clearCrossingTimes(times: CrossingTimes, car: CarId, from: number, to: number): void {
  const end = Math.min(to * CARS, times.at.length);
  for (let cell = from * CARS + car; cell < end; cell += CARS) times.at[cell] = NaN;
}

/**
 * Car `car` passed `progress` at `at`: it and every car that passed the same point before it (by `times`, each car's
 * crossing times by progress from 0) are judged on the time between them there. A pair that moves to another zone
 * judges each car again in the window of every set that holds the other; in the same zone nothing changes.
 */
export function judgeCrossing(w: GapperWindow, times: CrossingTimes, car: CarId, progress: number, at: SessionTime, { nearMs, farMs }: WindowThresholds): void {
  const row = progress * CARS;
  if (row >= times.at.length) return;
  const cells = times.at;
  for (let id = 0; id < CARS; id++) {
    if (id === car) continue;
    const t = cells[row + id] as number;
    if (t !== t) continue; // NaN: no crossing there
    const gap = Math.abs(at - t);
    const zone: Zone = gap <= nearMs ? NEAR : gap <= farMs ? EDGE : FAR;
    const pair = pairOf(car, id as CarId);
    if (zone !== w.zones[pair]) rezone(w, car, id as CarId, pair, zone);
  }
}

/** The pair `{a, b}` moved to `zone`: each car is judged again in the window of every set that holds the other. */
function rezone(w: GapperWindow, a: CarId, b: CarId, pair: number, zone: Zone): void {
  w.zones[pair] = zone;
  judgeAround(w, a, b);
  judgeAround(w, b, a);
}

/** The window of our cars (one or two): the other cars in their set's window, by id. */
export function othersInWindow(w: GapperWindow, ours: readonly CarId[]): CarId[] {
  const x = ours[0];
  if (x === undefined) return [];
  const set = pairOf(x, ours[1] ?? x);
  const others: CarId[] = [];
  for (let i = 0; i < CARS; i++) if (w.inside[set * CARS + i] === 1 && !ours.includes(i as CarId)) others.push(i as CarId);
  return others;
}
