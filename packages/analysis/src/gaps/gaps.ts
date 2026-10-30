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

const NOT_APPLICABLE = unknown('notApplicable');

const latestOf = (c: CarCrossings): number => c.fromProgress + c.at.length - 1;
const timeAt = (c: CarCrossings, progress: number): SessionTime | undefined => c.at[progress - c.fromProgress];

/** When the car passed its newest crossing. */
export const latestTime = (c: CarCrossings): SessionTime | undefined => timeAt(c, latestOf(c));

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
 * the time between them at the same point of the track. `carId` itself has no gap to itself: `notApplicable`.
 * `undefined` when `carId` is not a running car.
 */
export function gapsToCar(out: GapsOutput, carId: CarId): GapToCar[] | undefined {
  if (!out.intervals.some((i) => i.carId === carId)) return undefined;
  const to = out.recent[carId];
  return out.intervals.map((i) =>
    i.carId === carId ? { carId, gapMs: unknown('notApplicable'), lapsDown: 0 } : { carId: i.carId, ...gapTo(out.recent[i.carId], to) },
  );
}

/** The car's line crossings after the race start: its completed race laps. */
const raceLaps = (out: GapsOutput, carId: CarId, startAt: SessionTime) => (out.lineTimes[carId] ?? []).filter((l) => l.at > startAt);

/**
 * The car's mean lap so far: its race time at its newest crossing over its progress there (completed laps plus the part
 * of the current lap), so it is known from the first mini-sector and equals the mean of the completed laps at the line.
 * A finished car's race ends at its last line crossing, so its cool-down lap does not count. `insufficientData` before
 * its first crossing past the start line after lights out.
 */
function meanLap(out: GapsOutput, carId: CarId | undefined): Known<Ms> {
  const start = out.raceStartAt;
  if (!start.known) return start;
  const end = carId === undefined ? undefined : raceEnd(out, carId);
  if (end === undefined || end.at <= start.value || end.progress === 0) return unknown('insufficientData');
  return known(Math.round(((end.at - start.value) * MINI_SECTORS) / end.progress), end.at);
}

/** Where the car's race stands: its newest crossing, or a finished car's last line crossing. */
function raceEnd(out: GapsOutput, carId: CarId): { progress: number; at: SessionTime } | undefined {
  if (out.finished.includes(carId)) {
    const line = out.lineTimes[carId]?.at(-1);
    return line === undefined ? undefined : { progress: line.lap * MINI_SECTORS, at: line.at };
  }
  const crossings = out.recent[carId];
  const at = crossings === undefined ? undefined : latestTime(crossings);
  return crossings === undefined || at === undefined ? undefined : { progress: latestOf(crossings), at };
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
 * The car's gap now, at its newest crossing after `startAt`: `progress / 50` laps (its own completed laps plus the part
 * of the current lap) at the reference pace minus its race time, in whole ms. `notApplicable` at the line (the point
 * is the completed lap's), before its first crossing after lights out and once the car has finished (its cool-down lap
 * is no race).
 */
function gapNow(crossings: CarCrossings | undefined, startAt: SessionTime, referenceLapMs: Ms): GapperLines['cars'][number]['now'] {
  const at = crossings === undefined ? undefined : latestTime(crossings);
  if (crossings === undefined || at === undefined || at <= startAt) return NOT_APPLICABLE;
  const progress = latestOf(crossings);
  if (progress % MINI_SECTORS === 0) return NOT_APPLICABLE;
  return known({ lap: progress / MINI_SECTORS, gapMs: Math.round((progress * referenceLapMs) / MINI_SECTORS - (at - startAt)) }, at);
}

/**
 * Per running car, per completed race lap L, the gap to a virtual car that laps at the reference pace from lights
 * out: `L × referenceLap − (lineTime(L) − raceStart)`, positive = ahead of it; `now` is the same gap at the car's
 * newest mini-sector crossing. Without a known race start or reference lap every line is empty and `now` unknown.
 * `phases` are the calculator's, the same for every reference.
 */
export function gapperLines(out: GapsOutput, reference: GapperReference): GapperLines {
  const referenceLapMs = referenceLap(out, reference);
  const start = out.raceStartAt;
  const cars = out.intervals.map(({ carId }) => {
    if (!start.known) return { carId, byLap: [], now: unknown(start.reason) };
    if (!referenceLapMs.known) return { carId, byLap: [], now: unknown(referenceLapMs.reason) };
    return {
      carId,
      byLap: raceLaps(out, carId, start.value).map(({ lap, at }) => ({ lap, gapMs: lap * referenceLapMs.value - (at - start.value) })),
      now: out.finished.includes(carId) ? NOT_APPLICABLE : gapNow(out.recent[carId], start.value, referenceLapMs.value),
    };
  });
  const named = reference.kind === 'carAverage' ? known(reference.carId, 0) : unknown('notApplicable');
  return { reference: { kind: reference.kind, carId: named }, referenceLapMs, cars, phases: out.phases };
}
