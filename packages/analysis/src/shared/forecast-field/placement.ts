// Where the cars are (SP4.3a spec 6.1): the order and, without the live frame's lap progress, each car's lap fraction and
// gap "as of" the view's frame, from the projection's mini-sector crossings only: its newest crossing at or before the
// frame plus the time since at its current pace.
import { foldCurrentCrossing, MINI_SECTORS, type CarId, type CrossingIndex, type MiniSectorCrossing, type SessionTime } from '@pitwall/domain';

/** A crossing's distance into the race, in mini-sectors. */
export const distanceOf = (c: Pick<MiniSectorCrossing, 'lap' | 'segment'>): number => (c.lap - 1) * MINI_SECTORS + c.segment;

/** Each car's newest crossing (the last in log order) among `cars` slots. */
export function newestCrossings(crossings: readonly MiniSectorCrossing[], cars: number): (MiniSectorCrossing | undefined)[] {
  const newest = new Array<MiniSectorCrossing | undefined>(cars).fill(undefined);
  let left = cars;
  for (let i = crossings.length - 1; i >= 0 && left > 0; i--) {
    const c = crossings[i] as MiniSectorCrossing;
    if (c.carId < 0 || c.carId >= cars || newest[c.carId] !== undefined) continue;
    newest[c.carId] = c;
    left--;
  }
  return newest;
}

/**
 * The field's order, front first: the running cars by their newest crossing's distance (furthest first), then its time
 * (earliest first), then slot; the cars without a crossing behind them; the retired cars last, in the same rule.
 */
export function orderOf(newest: readonly (MiniSectorCrossing | undefined)[], retired: Uint8Array): Int8Array {
  const slots = newest.map((_, i) => i);
  const key = (i: number): [number, number, number] => {
    const c = newest[i];
    return [retired[i] as number, c === undefined ? 1 : 0, c === undefined ? 0 : -distanceOf(c)];
  };
  slots.sort((a, b) => {
    const [ra, na, da] = key(a);
    const [rb, nb, db] = key(b);
    if (ra !== rb) return ra - rb;
    if (na !== nb) return na - nb;
    if (da !== db) return da - db;
    const ta = newest[a]?.at ?? 0;
    const tb = newest[b]?.at ?? 0;
    return ta !== tb ? ta - tb : a - b;
  });
  return Int8Array.from(slots);
}

/**
 * The leader's current crossing times by distance from `from` to `upTo` (the domain's rule: a later crossing of the
 * same lap and segment supersedes, `foldCurrentCrossing`); `NaN` where it has none. The log is read back from its
 * newest crossing only until the leader's crossings fall below `from` (and one more), the older ones being further back.
 */
export function leaderTimes(crossings: readonly MiniSectorCrossing[], leader: CarId, from: number, upTo: number): Float64Array {
  const tail: MiniSectorCrossing[] = [];
  for (let i = crossings.length - 1; i >= 0; i--) {
    const c = crossings[i] as MiniSectorCrossing;
    if (c.carId !== leader) continue;
    tail.push(c);
    if (distanceOf(c) < from) break;
  }
  const index: CrossingIndex = new Map();
  for (let i = tail.length - 1; i >= 0; i--) foldCurrentCrossing(index, tail[i] as MiniSectorCrossing);
  const times = new Float64Array(upTo + 1).fill(NaN);
  for (const [lap, slots] of index.get(leader) ?? new Map<number, (MiniSectorCrossing | undefined)[]>()) {
    slots.forEach((c) => {
      if (c === undefined) return;
      const d = distanceOf({ lap, segment: c.segment });
      if (d >= 0 && d <= upTo) times[d] = c.at;
    });
  }
  return times;
}

/** When the leader was `d` mini-sectors into the race: linear between its nearest crossings around `d`; `undefined` without any. */
export function leaderTimeAt(times: Float64Array, d: number): number | undefined {
  const i = Math.min(Math.floor(d), times.length - 1);
  let lo = i;
  while (lo >= 0 && Number.isNaN(times[lo] as number)) lo--;
  let hi = Math.max(i + 1, 0);
  while (hi < times.length && Number.isNaN(times[hi] as number)) hi++;
  const tl = lo >= 0 ? (times[lo] as number) : undefined;
  const th = hi < times.length ? (times[hi] as number) : undefined;
  if (tl !== undefined && th !== undefined) return d <= lo ? tl : tl + ((d - lo) / (hi - lo)) * (th - tl);
  return tl ?? th;
}

/** Just under the next mini-sector: a car not yet across it is short of it. */
const SHORT_OF_NEXT = 1 - 1e-6;

/**
 * A car's place "as of" `at`: its newest crossing plus the time since at `lapMs` per lap (never past its next
 * mini-sector, which it has not crossed); a retired car stays at its newest crossing. In mini-sectors into the race.
 */
export function distanceAsOf(newest: MiniSectorCrossing | undefined, at: SessionTime, lapMs: number, retired: boolean): number {
  if (newest === undefined) return 0;
  const since = Math.max(0, at - newest.at);
  if (retired || !(lapMs > 0) || since === 0) return distanceOf(newest);
  return distanceOf(newest) + Math.min((since * MINI_SECTORS) / lapMs, SHORT_OF_NEXT);
}
