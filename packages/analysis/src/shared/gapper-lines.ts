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
