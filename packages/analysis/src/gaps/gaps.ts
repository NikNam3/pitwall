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

/** The car's line crossings after the race start: its completed race laps. */
const raceLaps = (out: GapsOutput, carId: CarId, startAt: SessionTime) => (out.lineTimes[carId] ?? []).filter((l) => l.at > startAt);

/**
 * The car's mean lap so far: its race time at its newest crossing over its progress there (completed laps plus the part
 * of the current lap), so it is known from the first mini-sector and equals the mean of the completed laps at the line.
 * A finished car needs no rule of its own: the game sends no crossing after the flag, so its newest crossing is its
 * finish. `insufficientData` before its first crossing past the start line after lights out.
 */
function meanLap(out: GapsOutput, carId: CarId | undefined): Known<Ms> {
  const start = out.raceStartAt;
  if (!start.known) return start;
  const crossings = carId === undefined ? undefined : out.recent[carId];
  const at = crossings === undefined ? undefined : latestTime(crossings);
  if (crossings === undefined || at === undefined || at <= start.value || latestOf(crossings) === 0) return unknown('insufficientData');
  return known(Math.round(((at - start.value) * MINI_SECTORS) / latestOf(crossings)), at);
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
 * is the completed lap's) and before its first crossing after lights out. A finisher keeps its point: no crossing
 * follows the flag, so its newest one is where its race ended.
 */
function gapNow(crossings: CarCrossings | undefined, startAt: SessionTime, referenceLapMs: Ms): GapperLines['cars'][number]['now'] {
  const at = crossings === undefined ? undefined : latestTime(crossings);
  if (crossings === undefined || at === undefined || at <= startAt) return NOT_APPLICABLE;
  const progress = latestOf(crossings);
  if (progress % MINI_SECTORS === 0) return NOT_APPLICABLE;
  return known({ lap: progress / MINI_SECTORS, gapMs: Math.round((progress * referenceLapMs) / MINI_SECTORS - (at - startAt)) }, at);
}

/** A gapper point: at `progress` (x = progress / 50) the gap to the virtual car, `progress / 50 × lapMs − (at − startAt)`. */
const pointAt = (progress: number, at: SessionTime, startAt: SessionTime, lapMs: Ms) => ({
  lap: progress / MINI_SECTORS,
  gapMs: Math.round((progress * lapMs) / MINI_SECTORS - (at - startAt)),
});

/**
 * The car's gapper points after `startAt`: one per completed race lap before its `fine` crossings, at the line, then one
 * per fine crossing (the last `fineLaps` completed laps and the current one). The start line (x = 0) has none.
 */
function pointsOf(out: GapsOutput, carId: CarId, startAt: SessionTime, lapMs: Ms): GapperLines['cars'][number]['points'] {
  const fine = out.fine[carId];
  if (fine === undefined) return [];
  const perLap = raceLaps(out, carId, startAt)
    .filter(({ lap }) => lap * MINI_SECTORS < fine.fromProgress)
    .map(({ lap, at }) => pointAt(lap * MINI_SECTORS, at, startAt, lapMs));
  const perCrossing = fine.at.flatMap((at, i) => (at === undefined || at <= startAt ? [] : [pointAt(fine.fromProgress + i, at, startAt, lapMs)]));
  return [...perLap, ...perCrossing];
}

/**
 * The cars of the window (`GapsOutput.gapperWindow`), running or out of the race: per car, per completed race lap L, the gap to a virtual car that
 * laps at the reference pace from lights out: `L × referenceLap − (lineTime(L) − raceStart)`, positive = ahead of it;
 * `points` that gap per crossing for the last `fineLaps` laps, per lap before; `now` is the same gap at the car's newest
 * mini-sector crossing. Without a known race start or reference lap every line is empty and `now` unknown. A car out of the race keeps its line while it has completed race laps, with no
 * `now` (`notApplicable`): the chart names a line that ends early at its own end. `phases` are the calculator's, the
 * same for every reference.
 */
export function gapperLines(out: GapsOutput, reference: GapperReference): GapperLines {
  const referenceLapMs = referenceLap(out, reference);
  const start = out.raceStartAt;
  const { ours, others } = out.gapperWindow;
  const inWindow = (carId: CarId) => ours.includes(carId) || others.includes(carId);
  const line = (carId: CarId, startAt: SessionTime, lapMs: Ms) => ({ carId, points: pointsOf(out, carId, startAt, lapMs) });
  const running = out.intervals
    .filter(({ carId }) => inWindow(carId))
    .map(({ carId }) =>
      !start.known ? { carId, points: [], now: unknown(start.reason) }
      : !referenceLapMs.known ? { carId, points: [], now: unknown(referenceLapMs.reason) }
      : { ...line(carId, start.value, referenceLapMs.value), now: gapNow(out.recent[carId], start.value, referenceLapMs.value) },
    );
  const stopped =
    !start.known || !referenceLapMs.known ? [] : (
      out.outOfRace
        .filter((carId) => inWindow(carId) && raceLaps(out, carId, start.value).length > 0)
        .map((carId) => ({ ...line(carId, start.value, referenceLapMs.value), now: NOT_APPLICABLE }))
    );
  const cars = [...running, ...stopped];
  const named = reference.kind === 'carAverage' ? known(reference.carId, 0) : unknown('notApplicable');
  return { reference: { kind: reference.kind, carId: named }, referenceLapMs, cars, phases: out.phases };
}
