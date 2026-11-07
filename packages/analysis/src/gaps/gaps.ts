// The maths of `gaps` (spec 6.1): gaps from the mini-sector crossings and every car's gap to one car; the gapper is
// `shared/gapper-lines.ts`.
import { known, MINI_SECTORS, unknown, type CarId, type GapToCar, type Known, type Ms, type SessionTime } from '@pitwall/domain';
import { latestOf, latestTime, timeAt, type CarCrossings } from '../shared/gapper-lines.ts';
import type { GapsOutput } from './index.ts';

export { latestTime, type CarCrossings };

/**
 * Where a crossing is, in mini-sectors from the start line. Segment 0 is the line at the start of its lap (the engine's
 * convention), so the line that completes lap L is `(L + 1, 0)`, at `L × 50`.
 */
export const progressOf = (m: { lap: number; segment: number }): number => (m.lap - 1) * MINI_SECTORS + m.segment;

/** How many crossings per car `GapsOutput.recent` keeps: two laps. */
export const RECENT_CROSSINGS = 2 * MINI_SECTORS;

const NOT_APPLICABLE = unknown('notApplicable');

/**
 * The car's furthest progress by `t`: its newest crossing at or before `t` (crossing times grow with progress; holes are
 * skipped), by binary search. `undefined` before its first crossing.
 */
export function progressAt(c: CarCrossings, t: SessionTime): number | undefined {
  let lo = 0;
  let hi = c.at.length - 1;
  let best: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let i = mid;
    while (i >= lo && c.at[i] === undefined) i--;
    if (i < lo) lo = mid + 1;
    else if ((c.at[i] as SessionTime) <= t) {
      best = i;
      lo = mid + 1;
    } else hi = i - 1;
  }
  return best === undefined ? undefined : c.fromProgress + best;
}

/** The car's last `RECENT_CROSSINGS` crossings, as a new object. */
export const recentOf = (c: CarCrossings): CarCrossings => {
  const from = Math.max(c.fromProgress, latestOf(c) - RECENT_CROSSINGS + 1);
  return { fromProgress: from, at: c.at.slice(from - c.fromProgress) };
};

/**
 * The car's crossings of the last `fineLaps` completed laps and the current one (progress after
 * `(completed − fineLaps) × 50`, the start line excluded), as a new object.
 */
export const fineOf = (c: CarCrossings, fineLaps: number): CarCrossings => {
  const latest = latestOf(c);
  const completed = Math.floor(latest / MINI_SECTORS);
  const from = Math.max(c.fromProgress, 1, (completed - fineLaps) * MINI_SECTORS + 1);
  return { fromProgress: from, at: c.at.slice(from - c.fromProgress) };
};

/** Whole laps car `a` is behind car `b` on the road, from their progress; 0 when `a` is not behind. */
export const lapsBehind = (a: CarCrossings, b: CarCrossings): number => Math.max(0, Math.floor((latestOf(b) - latestOf(a)) / MINI_SECTORS));

/**
 * The signed gap of car `a` behind car `b` (positive = behind), with `a` counted `laps` laps down: `a`'s time at a
 * point minus `b`'s time at the same point `laps` laps later. The point is the last one both passed, so a car `b` has
 * not reached yet is behind it, and `gapBehind(a, b) = −gapBehind(b, a)`. With `laps` from `lapsBehind` it is the time
 * since `b` passed where `a` is now. `notReceived` while either car lacks the crossing.
 */
export function gapBehind(a: CarCrossings | undefined, b: CarCrossings | undefined, laps = 0): Known<Ms> {
  if (a === undefined || b === undefined) return unknown('notReceived');
  const point = Math.min(latestOf(a), latestOf(b) - laps * MINI_SECTORS);
  const ta = timeAt(a, point);
  const tb = timeAt(b, point + laps * MINI_SECTORS);
  if (ta === undefined || tb === undefined) return unknown('notReceived');
  return known(ta - tb, Math.max(ta, tb));
}

/** The gap of `a` to `to` with the laps between them: `a` down `lapsDown` laps (negative = up), then `gapMs` at the same point. */
function gapTo(a: CarCrossings | undefined, to: CarCrossings | undefined): Omit<GapToCar, 'carId'> {
  if (a === undefined || to === undefined) return { lapsDown: 0, gapMs: unknown('notReceived') };
  const down = lapsBehind(a, to);
  if (down > 0) return { lapsDown: down, gapMs: gapBehind(a, to, down) };
  const up = lapsBehind(to, a);
  const ahead = gapBehind(to, a, up);
  return { lapsDown: 0 - up, gapMs: ahead.known ? known(0 - ahead.value, ahead.at) : ahead };
}

/**
 * Every running car's signed gap to `carId` (positive = behind it), exact from both cars' crossings at the latest
 * point both passed. `lapsDown` is signed and relative to `carId` (negative = laps ahead); a lapped pair's `gapMs` is
 * the time between them at the same point of the track. `carId` itself has no gap to itself, and a car out of the race
 * gets none (it will not come): both `notApplicable`. `undefined` when `carId` is not a running car.
 */
export function gapsToCar(out: GapsOutput, carId: CarId): GapToCar[] | undefined {
  if (!out.intervals.some((i) => i.carId === carId)) return undefined;
  const to = out.recent[carId];
  const none = (id: CarId): GapToCar => ({ carId: id, gapMs: NOT_APPLICABLE, lapsDown: 0 });
  return [
    ...out.intervals.map((i) => (i.carId === carId ? none(carId) : { carId: i.carId, ...gapTo(out.recent[i.carId], to) })),
    ...out.outOfRace.map(none),
  ];
}
