// The gapper (spec 6.1): every car's gap to a virtual car at a reference pace, from `gaps`' output; shared so the
// units that build on the gapper's lines (`gaps.gapper`, `rejoin`'s ghost lines) compute them one way (C43).
import { known, MINI_SECTORS, unknown, type CarId, type GapperLines, type GapperReference, type Known, type Ms, type SessionTime } from '@pitwall/domain';
import type { GapsOutput } from '../gaps/output.ts';

/** A car's crossing times by progress, from `fromProgress` up to its newest crossing (the calculator keeps all, from 0). */
export type CarCrossings = GapsOutput['recent'][CarId];

const NOT_APPLICABLE = unknown('notApplicable');

/** The car's newest progress. */
export const latestOf = (c: CarCrossings): number => c.fromProgress + c.at.length - 1;

/** When the car passed `progress`; `undefined` for a hole or outside its crossings. */
export const timeAt = (c: CarCrossings, progress: number): SessionTime | undefined => c.at[progress - c.fromProgress];

/** When the car passed its newest crossing. */
export const latestTime = (c: CarCrossings): SessionTime | undefined => timeAt(c, latestOf(c));

/**
 * Where the gapper starts: the virtual car leaves progress `from` (0 at lights out, `lap × 50` at a join) at `at`, so
 * each car's race time counts from `at` and its distance from `from`.
 */
type Start = { at: SessionTime; from: number };

/** The output's origin; one built by hand without it starts at `raceStartAt`, as lights out. */
function originOf(out: GapsOutput): NonNullable<GapsOutput['origin']> {
  if (out.origin !== undefined) return out.origin;
  const start = out.raceStartAt;
  return start.known ? known({ kind: 'lightsOut', at: start.value }, start.at) : start;
}

/** The start of an origin: its time, and its progress (`lap × 50` of a join). */
const startOf = (origin: Extract<NonNullable<GapsOutput['origin']>, { known: true }>['value']): Start => ({
  at: origin.at,
  from: origin.kind === 'join' ? origin.lap * MINI_SECTORS : 0,
});

/** The origin as the gapper's lines name it: without its time. */
const namedOrigin = (origin: NonNullable<GapsOutput['origin']>): GapperLines['origin'] => {
  if (!origin.known) return origin;
  const value = origin.value.kind === 'join' ? { kind: 'join' as const, lap: origin.value.lap } : { kind: 'lightsOut' as const };
  return known(value, origin.at);
};

/** The car's line crossings after the start, from its progress on: its completed race laps. */
const raceLaps = (out: GapsOutput, carId: CarId, start: Start) =>
  (out.lineTimes[carId] ?? []).filter((l) => l.at > start.at && l.lap * MINI_SECTORS >= start.from);

/**
 * The car's mean lap so far: its race time at its newest crossing over its progress there since the start (completed
 * laps plus the part of the current lap), so it is known from the first mini-sector and equals the mean of the
 * completed laps at the line. A finished car needs no rule of its own: the game sends no crossing after the flag, so its
 * newest crossing is its finish. `insufficientData` before its first crossing past the start.
 */
function meanLap(out: GapsOutput, carId: CarId | undefined, origin: NonNullable<GapsOutput['origin']>): Known<Ms> {
  if (!origin.known) return origin;
  const start = startOf(origin.value);
  const crossings = carId === undefined ? undefined : out.recent[carId];
  const at = crossings === undefined ? undefined : latestTime(crossings);
  if (crossings === undefined || at === undefined || at <= start.at || latestOf(crossings) <= start.from) return unknown('insufficientData');
  return known(Math.round(((at - start.at) * MINI_SECTORS) / (latestOf(crossings) - start.from)), at);
}

/** The virtual car's lap time; a fixed lap is given, so it is known from the start. */
function referenceLap(out: GapsOutput, reference: GapperReference, origin: NonNullable<GapsOutput['origin']>): Known<Ms> {
  switch (reference.kind) {
    case 'leaderAverage':
      return meanLap(out, out.intervals[0]?.carId, origin);
    case 'carAverage':
      return meanLap(out, reference.carId, origin);
    case 'fixed':
      return known(reference.lapMs, 0);
  }
}

/** A gapper point: at `progress` (x = progress / 50) the gap to the virtual car, `(progress − from) / 50 × lapMs − (at − start)`. */
const gapperPoint = (progress: number, at: SessionTime, start: Start, lapMs: Ms) => ({
  lap: progress / MINI_SECTORS,
  gapMs: Math.round(((progress - start.from) * lapMs) / MINI_SECTORS - (at - start.at)),
});

/**
 * The car's gap now, at its newest crossing after the start: the gapper point there. `notApplicable` at the line (the
 * point is the completed lap's) and before its first crossing after the start. A finisher keeps its point: no crossing
 * follows the flag, so its newest one is where its race ended.
 */
function gapNow(crossings: CarCrossings | undefined, start: Start, referenceLapMs: Ms): GapperLines['cars'][number]['now'] {
  const at = crossings === undefined ? undefined : latestTime(crossings);
  if (crossings === undefined || at === undefined || at <= start.at) return NOT_APPLICABLE;
  const progress = latestOf(crossings);
  if (progress % MINI_SECTORS === 0 || progress < start.from) return NOT_APPLICABLE;
  return known(gapperPoint(progress, at, start, referenceLapMs), at);
}

/**
 * The car's gapper points after the start: one per completed race lap before its `fine` crossings, at the line, then
 * one per fine crossing (the last `fineLaps` completed laps and the current one), none before the start's progress.
 * The start line (x = 0) has none.
 */
function pointsOf(out: GapsOutput, carId: CarId, start: Start, lapMs: Ms): GapperLines['cars'][number]['points'] {
  const fine = out.fine[carId];
  if (fine === undefined) return [];
  const perLap = raceLaps(out, carId, start)
    .filter(({ lap }) => lap * MINI_SECTORS < fine.fromProgress)
    .map(({ lap, at }) => gapperPoint(lap * MINI_SECTORS, at, start, lapMs));
  const perCrossing = fine.at.flatMap((at, i) => {
    const progress = fine.fromProgress + i;
    return at === undefined || at <= start.at || progress < start.from ? [] : [gapperPoint(progress, at, start, lapMs)];
  });
  return [...perLap, ...perCrossing];
}

/**
 * The cars of the window (`GapsOutput.gapperWindow`), running or out of the race: per completed race lap L, the gap to
 * a virtual car that laps at the reference pace from the origin (lights out, or the leader's first line crossing after
 * a join at lap J): `(L − J) × referenceLap − (lineTime(L) − originTime)`, positive = ahead of it (J = 0 at lights out);
 * `points` that gap per crossing for the last `fineLaps` laps, per lap before; `now` is the same gap at the car's newest
 * mini-sector crossing. Without a known origin or reference lap every line is empty and `now` unknown. A car out of the
 * race keeps its line while it has completed race laps, with no `now` (`notApplicable`): the chart names a line that
 * ends early at its own end. `phases` are the calculator's, the same for every reference.
 */
export function gapperLines(out: GapsOutput, reference: GapperReference): GapperLines {
  const origin = originOf(out);
  const referenceLapMs = referenceLap(out, reference, origin);
  const { ours, others } = out.gapperWindow;
  const inWindow = (carId: CarId) => ours.includes(carId) || others.includes(carId);
  const line = (carId: CarId, start: Start, lapMs: Ms) => ({ carId, points: pointsOf(out, carId, start, lapMs) });
  const start = origin.known ? startOf(origin.value) : undefined;
  const running = out.intervals
    .filter(({ carId }) => inWindow(carId))
    .map(({ carId }) =>
      !origin.known ? { carId, points: [], now: unknown(origin.reason) }
      : !referenceLapMs.known || start === undefined ? { carId, points: [], now: unknown(referenceLapMs.known ? 'notReceived' : referenceLapMs.reason) }
      : { ...line(carId, start, referenceLapMs.value), now: gapNow(out.recent[carId], start, referenceLapMs.value) },
    );
  const stopped =
    start === undefined || !referenceLapMs.known ? [] : (
      out.outOfRace
        .filter((carId) => inWindow(carId) && raceLaps(out, carId, start).length > 0)
        .map((carId) => ({ ...line(carId, start, referenceLapMs.value), now: NOT_APPLICABLE }))
    );
  const cars = [...running, ...stopped];
  const named = reference.kind === 'carAverage' ? known(reference.carId, 0) : unknown('notApplicable');
  return { reference: { kind: reference.kind, carId: named }, origin: namedOrigin(origin), referenceLapMs, cars, phases: out.phases };
}
