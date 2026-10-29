// The maths of `gaps` (spec 6.1): gaps from the mini-sector crossings, every car's gap to one car, and the gapper.
import { known, MINI_SECTORS, unknown, type CarId, type GapperLines, type GapperReference, type GapToCar, type Known, type Ms, type SessionTime } from '@pitwall/domain';
import type { GapsOutput } from './index.ts';

/**
 * Where a crossing is, in mini-sectors from the start line. Segment 0 is the line at the start of its lap (the engine's
 * convention), so the line that completes lap L is `(L + 1, 0)`, at `L × 50`.
 */
export const progressOf = (m: { lap: number; segment: number }): number => (m.lap - 1) * MINI_SECTORS + m.segment;

/** How many crossings per car `GapsOutput.recent` keeps: two laps. */
export const RECENT_CROSSINGS = 2 * MINI_SECTORS;

/** A car's crossing times by progress, from `fromProgress` up to its newest crossing (the calculator keeps all, from 0). */
export type CarCrossings = GapsOutput['recent'][CarId];

const latestOf = (c: CarCrossings): number => c.fromProgress + c.at.length - 1;
const timeAt = (c: CarCrossings, progress: number): SessionTime | undefined => c.at[progress - c.fromProgress];

/** When the car passed its newest crossing. */
export const latestTime = (c: CarCrossings): SessionTime | undefined => timeAt(c, latestOf(c));

/** The car's last `RECENT_CROSSINGS` crossings, as a new object. */
export const recentOf = (c: CarCrossings): CarCrossings => {
  const from = Math.max(c.fromProgress, latestOf(c) - RECENT_CROSSINGS + 1);
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
 * the time between them at the same point of the track. `undefined` when `carId` is not a running car.
 */
export function gapsToCar(out: GapsOutput, carId: CarId): GapToCar[] | undefined {
  if (!out.intervals.some((i) => i.carId === carId)) return undefined;
  const to = out.recent[carId];
  return out.intervals.map((i) => ({ carId: i.carId, ...gapTo(out.recent[i.carId], to) }));
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
  const named = reference.kind === 'carAverage' ? known(reference.carId, 0) : unknown('notApplicable');
  return { reference: { kind: reference.kind, carId: named }, referenceLapMs, cars };
}
