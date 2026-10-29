// The maths of `gaps` (spec 6.1): gaps from the mini-sector crossings, every car's gap to one car, and the gapper.
import { known, MINI_SECTORS, unknown, type CarId, type GapperLines, type GapperReference, type GapToCar, type Known, type Ms, type SessionTime } from '@pitwall/domain';
import type { GapsOutput } from './index.ts';

/**
 * Where a crossing is, in mini-sectors from the start line. Segment 0 is the line at the start of its lap (the engine's
 * convention), so the line that completes lap L is `(L + 1, 0)`, at `L × 50`.
 */
export const progressOf = (m: { lap: number; segment: number }): number => (m.lap - 1) * MINI_SECTORS + m.segment;

/** One car's crossings: the time of each by its progress, and the progress of the newest one. */
export type CarTrack = { times: SessionTime[]; latest: number };

/** Whole laps car `a` is behind car `b` on the road, from their progress; 0 when `a` is not behind. */
export const lapsBehind = (a: CarTrack, b: CarTrack): number => Math.max(0, Math.floor((b.latest - a.latest) / MINI_SECTORS));

/**
 * The signed gap of car `a` behind car `b` (positive = behind), with `a` counted `laps` laps down: `a`'s time at a
 * point minus `b`'s time at the same point `laps` laps later. The point is the last one both passed, so a car `b` has
 * not reached yet is behind it, and `gapBehind(a, b) = −gapBehind(b, a)`. With `laps` from `lapsBehind` it is the time
 * since `b` passed where `a` is now. `notReceived` while either car lacks the crossing.
 */
export function gapBehind(a: CarTrack | undefined, b: CarTrack | undefined, laps = 0): Known<Ms> {
  if (a === undefined || b === undefined) return unknown('notReceived');
  const point = Math.min(a.latest, b.latest - laps * MINI_SECTORS);
  const ta = a.times[point];
  const tb = b.times[point + laps * MINI_SECTORS];
  if (ta === undefined || tb === undefined) return unknown('notReceived');
  return known(ta - tb, Math.max(ta, tb));
}

/** `a − b`, or the reason of the first unknown one. */
const difference = (a: Known<Ms>, b: Known<Ms>): Known<Ms> => {
  if (!a.known) return a;
  if (!b.known) return b;
  return known(a.value - b.value, Math.max(a.at, b.at));
};

/**
 * Every running car's signed gap to `carId` (positive = behind it), from the gaps to the leader: `lapsDown` is how
 * many laps more than `carId` a car is down (negative = laps ahead), on top of `gapMs`. `undefined` when `carId` is not
 * a running car.
 */
export function gapsToCar(out: GapsOutput, carId: CarId): GapToCar[] | undefined {
  const to = out.intervals.find((i) => i.carId === carId);
  if (to === undefined) return undefined;
  return out.intervals.map((i) => ({
    carId: i.carId,
    gapMs: difference(i.toLeaderMs, to.toLeaderMs),
    lapsDown: i.lapsDown - to.lapsDown,
  }));
}

/** The car's line crossings after the race start: its completed race laps. */
const raceLaps = (out: GapsOutput, carId: CarId, startAt: SessionTime) => (out.lineTimes[carId] ?? []).filter((l) => l.at > startAt);

/** The car's mean lap from the race start to its latest line crossing. */
function meanLap(out: GapsOutput, carId: CarId | undefined): Known<Ms> {
  const start = out.raceStartAt;
  if (!start.known) return start;
  const last = carId === undefined ? undefined : raceLaps(out, carId, start.value).at(-1);
  if (last === undefined) return unknown('insufficientData');
  return known(Math.round((last.at - start.value) / last.lap), last.at);
}

/** The virtual car's lap time; a fixed lap is given, so it is known from the start. */
function referenceLap(out: GapsOutput, reference: GapperReference): Known<Ms> {
  switch (reference.kind) {
    case 'leaderAverage':
      return meanLap(out, out.intervals[0]?.carId);
    case 'carAverage':
      return meanLap(out, reference.carId);
    case 'fixed':
      return known(reference.lapMs, 0);
  }
}

/**
 * Per running car, per completed race lap L, the gap to a virtual car that laps at the reference pace from lights
 * out: `L × referenceLap − (lineTime(L) − raceStart)`, positive = ahead of it. Without a known race start or
 * reference lap every line is empty.
 */
export function gapperLines(out: GapsOutput, reference: GapperReference): GapperLines {
  const referenceLapMs = referenceLap(out, reference);
  const start = out.raceStartAt;
  const cars = out.intervals.map(({ carId }) => ({
    carId,
    byLap:
      referenceLapMs.known && start.known
        ? raceLaps(out, carId, start.value).map(({ lap, at }) => ({ lap, gapMs: lap * referenceLapMs.value - (at - start.value) }))
        : [],
  }));
  return { referenceLapMs, cars };
}
