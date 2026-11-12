// `forecast-score`'s natural experiments (SP4.3a spec 7.1, O12; plan Task 19): pure functions of the projection that
// find the rejoins, undercuts and SC stops worth scoring, and how each is measured. Dry laps only: a case on a lap on
// inter or wet tyres, or around a weather crossover (a stop from slicks to inter or wet tyres, or back), is no case.
import { currentCrossings, known, unknown, type CarId, type FrameNumber, type Known, type LapRecord, type PitStopRecord, type Policy, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly, Projection, Situation } from '@pitwall/engine/readers';
import { isClosed, neutralisedSpans, type Neutralisation } from '../shared/neutralised.ts';
import type { FORECAST_SCORE_CONFIG } from './config.ts';
import { raceLaps, type RaceLaps } from './laps.ts';

/** The effective config of `forecast-score`. */
export type ForecastScoreConfig = typeof FORECAST_SCORE_CONFIG.defaults;

export type CaseKind = 'rejoin' | 'undercut' | 'scStop';

/**
 * One natural experiment. Gaps and positions are read from the confirmed lap records (`currentLaps`, C25): the gap of
 * two cars at the end of lap k is `completedAt(otherCarId, k) − completedAt(carId, k)`.
 *
 * - `rejoin`: a green stop of `carId` on lap s (its in lap). `predictFrame`: the frame of its lap s − 1 record (the
 *   in-lap crossing). `measure`: its `positionAtEnd` on lap s + 1 (the first crossing after the out lap), in places.
 * - `undercut`: `carId` stops first (lap s1), `otherCarId` second (lap s2, `minLapsApart` ≤ s2 − s1 ≤ `maxLapsApart`),
 *   within `closeGapMs` (absolute) at the end of lap s1 − 1, no neutralisation span between that crossing and the end
 *   of lap s2 + 1. `predictFrame`: `carId`'s lap s1 − 1 record. `measure`: the change of their gap from the end of lap
 *   s1 − 1 to the end of lap s2 + 1 (the second car's out lap), in ms.
 * - `scStop`: a stop of `carId` on lap s whose `flag` is `sc` or `vsc`, against `otherCarId`, a car that made no stop
 *   during that neutralisation and was within ±`scPlaces` of `carId` by `positionAtEnd` of lap s − 1. `predictFrame`:
 *   `carId`'s lap s − 1 record. `measure`: the change of their gap from the end of lap s − 1 to the end of lap n +
 *   `scSettleLaps`, where n is `carId`'s first lap completed after the neutralisation span's end, in ms.
 *
 * `lap`: the stop lap (s, s1). `predictAt`: the race-clock time of `predictFrame` (the record's `completedAt`).
 * `targetLap`: the lap (of the cars measured) whose end `measure` reads.
 *
 * `policy` (by car slot, every car of the race; plan review P7): every car, the tested ones included, follows its
 * actual stops not yet made at `predictFrame` (its in lap not yet completed), each with the compound it left on; a
 * penalty stop is no policy stop. So the case isolates the rejoin, undercut or SC stop it tests.
 */
export type Case = {
  kind: CaseKind;
  carId: CarId;
  otherCarId?: CarId;
  predictFrame: FrameNumber;
  predictAt: SessionTime;
  lap: number;
  targetLap: number;
  policy: Policy[];
  measure: (history: Projection) => number;
};

export type Experiments = { rejoin: Case[]; undercut: Case[]; scStop: Case[] };

/** The lap record `measure` needs; its absence on the projection the case came from is a bug of the caller. */
function confirmed(history: DeepReadonly<Projection>, car: number, n: number): DeepReadonly<LapRecord> {
  // the newest confirmed record of the lap is its current one (C25: a confirmed record replaces anything)
  const laps = history.laps;
  for (let i = laps.length - 1; i >= 0; i--) {
    const l = laps[i] as DeepReadonly<LapRecord>;
    if (l.carId === car && l.lapNumber === n && l.status === 'confirmed') return l;
  }
  throw new Error(`forecast-score: car ${car} has no confirmed lap ${n}`);
}

/** The change of the gap of `other` behind `car` from the end of lap `from` to the end of lap `to`, measured on `history`. */
const gapChange = (car: number, other: number, from: number, to: number) => (history: Projection): number => {
  const start = confirmed(history, other, from).completedAt - confirmed(history, car, from).completedAt;
  return confirmed(history, other, to).completedAt - confirmed(history, car, to).completedAt - start;
};

/** Every car's actual stops not yet made at `frame` (P7): by car slot, each onto the compound it left on. */
export function actualStops(history: DeepReadonly<Projection>, race: RaceLaps, frame: FrameNumber, cars: number = race.cars): Policy[] {
  const policies: Policy[] = Array.from({ length: cars }, () => ({ stops: [] }));
  for (const stop of history.pitStops) {
    if (stop.penaltyServed || stop.carId >= cars || race.inLapFrame(stop) <= frame) continue;
    const compound = race.compoundAfter(stop.carId, stop.lap);
    if (compound !== undefined) policies[stop.carId]?.stops.push({ lap: stop.lap, compound });
  }
  for (const p of policies) p.stops.sort((a, b) => a.lap - b.lap);
  return policies;
}

/** Whether `span` covers any frame of `[from, to]` (C26: frames, never times). */
const overlaps = (span: Neutralisation, from: FrameNumber, to: FrameNumber): boolean =>
  span.startFrame <= to && (!isClosed(span) || span.endFrame > from);

/**
 * The natural experiments of `history` (and the open spans of `situation`, for a running session). Rejoin: every green
 * stop, but a repair (stationary longer than `repairStationaryMs`) and a penalty stop (`penaltyServed`). Every kind:
 * dry laps only, weather crossovers excluded; the undercut and the SC stop leave repairs and penalty stops out too.
 */
export function naturalExperiments(history: Projection, config: ForecastScoreConfig, situation?: Situation): Experiments {
  const race = raceLaps(history);
  const neutralisations = neutralisedSpans(history, situation ?? { weekendPhase: { kind: 'pending' }, byMachine: {} });
  const usable = (s: DeepReadonly<PitStopRecord>) => !s.penaltyServed && s.stationaryTimeMs <= config.repairStationaryMs && !race.crossover(s.carId, s.lap);
  const green = history.pitStops.filter((s) => s.flag === 'green' && usable(s));
  const base = (kind: CaseKind, car: CarId, lap: number, targetLap: number) => {
    const before = race.lap(car, lap - 1);
    if (before === undefined) return undefined;
    return { kind, carId: car, predictFrame: before.frame, predictAt: before.completedAt, lap, targetLap, policy: actualStops(history, race, before.frame) };
  };

  const rejoin: Case[] = [];
  for (const stop of green) {
    const s = stop.lap;
    if (race.lap(stop.carId, s + 1) === undefined || !race.dry(stop.carId, s - 1, s + 1)) continue;
    const c = base('rejoin', stop.carId, s, s + 1);
    if (c !== undefined) rejoin.push({ ...c, measure: (h) => confirmed(h, stop.carId, s + 1).positionAtEnd });
  }

  const undercut: Case[] = [];
  const minApart = Math.max(1, config.minLapsApart);
  for (const first of green) {
    for (const second of green) {
      const [a, b, s1, s2] = [first.carId, second.carId, first.lap, second.lap];
      if (a === b || s2 - s1 < minApart || s2 - s1 > config.maxLapsApart) continue;
      const [a0, b0, a2, b2] = [race.lap(a, s1 - 1), race.lap(b, s1 - 1), race.lap(a, s2 + 1), race.lap(b, s2 + 1)];
      if (a0 === undefined || b0 === undefined || a2 === undefined || b2 === undefined) continue;
      if (Math.abs(b0.completedAt - a0.completedAt) > config.closeGapMs) continue;
      if (!race.dry(a, s1 - 1, s2 + 1) || !race.dry(b, s1 - 1, s2 + 1)) continue;
      const from = Math.min(a0.frame, b0.frame);
      const to = Math.max(a2.frame, b2.frame);
      if (neutralisations.some((n) => overlaps(n, from, to))) continue;
      const c = base('undercut', a, s1, s2 + 1);
      if (c !== undefined) undercut.push({ ...c, otherCarId: b, measure: gapChange(a, b, s1 - 1, s2 + 1) });
    }
  }

  const scStop: Case[] = [];
  for (const stop of history.pitStops) {
    if (stop.flag === 'green' || !usable(stop)) continue;
    const x = stop.carId;
    const s = stop.lap;
    const span = neutralisations.find((n) => n.kind === 'neutralised' && overlaps(n, race.inLapFrame(stop), stop.frame));
    const before = race.lap(x, s - 1);
    if (span === undefined || !isClosed(span) || before === undefined) continue;
    const n = race.lapsOf(x).find((l) => l.frame >= span.endFrame)?.lapNumber;
    if (n === undefined) continue;
    const k = n + config.scSettleLaps;
    if (race.lap(x, k) === undefined || !race.dry(x, s - 1, k)) continue;
    const stayedOut = (o: number) => !history.pitStops.some((p) => p.carId === o && overlaps(span, race.inLapFrame(p), p.frame));
    for (let o = 0; o < race.cars; o++) {
      const other = race.lap(o, s - 1);
      if (o === x || other === undefined || Math.abs(other.positionAtEnd - before.positionAtEnd) > config.scPlaces) continue;
      if (race.lap(o, k) === undefined || !race.dry(o, s - 1, k) || !stayedOut(o)) continue;
      const c = base('scStop', x, s, k);
      if (c !== undefined) scStop.push({ ...c, otherCarId: o as CarId, measure: gapChange(x, o, s - 1, k) });
    }
  }
  return { rejoin, undercut, scStop };
}

/**
 * The race order at `stop`'s pit exit, measured from the projection: every car by its newest current crossing on or
 * before the stop's frame (the pit exit, C26: frames, never times) (lap, then segment, then the earlier crossing
 * first); `insufficientData` when the stopping car has no crossing by then.
 */
export function orderAtPitExit(history: Projection, stop: PitStopRecord): Known<CarId[]> {
  const newest = new Map<CarId, { lap: number; segment: number; at: number }>();
  for (const c of currentCrossings(history.crossings)) {
    if (c.frame > stop.frame) continue;
    const n = newest.get(c.carId);
    if (n === undefined || c.lap > n.lap || (c.lap === n.lap && c.segment > n.segment)) newest.set(c.carId, c);
  }
  if (!newest.has(stop.carId)) return unknown('insufficientData');
  const order = [...newest.entries()].sort(([ca, a], [cb, b]) => b.lap - a.lap || b.segment - a.segment || a.at - b.at || ca - cb).map(([car]) => car);
  return known(order, stop.pitLaneExit);
}
