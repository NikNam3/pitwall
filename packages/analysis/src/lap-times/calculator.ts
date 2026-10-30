// The `lap-times` calculator: every car's last and best times, the session bests, and each car's projected lap (spec 6.2).
import {
  addLaps,
  carId as toCarId,
  emptyCurrentLaps,
  known,
  unknown,
  type CarId,
  type CurrentLaps,
  type DriverStatus,
  type Known,
  type LapRecord,
  type MiniSectorCrossing,
  type Ms,
  type PitStatus,
  type Projection,
  type SessionKind,
} from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine';
import { bestsOf, rowOf, sessionBestBoard, sessionBestsOf, type Best, type CarBests } from './lap-times.ts';
import { LAP_TIMES, LAP_TIMES_CONFIG, type LapTimesOutput } from './index.ts';

/** The crossings of one lap of one car: time by segment, and the newest. */
type LapCrossings = { at: number[]; latest: { segment: number; at: number } };

type CarSnapshot = { id: CarId; active: boolean; lap: number; driverStatus: DriverStatus; pitStatus: PitStatus };

type Acc = {
  laps: CurrentLaps;
  /** Per car, then lap number. */
  crossings: Array<Map<number, LapCrossings>>;
  cars: CarSnapshot[];
  session: { kind: SessionKind; sessionType: number; numActiveCars: number; timeLeftMs: Ms; updatedAt: number };
  eliminated: { q1: number; q2: number };
};

const notApplicable = unknown('notApplicable');
const insufficientData = unknown('insufficientData');

const foldLaps = (acc: Acc, view: EngineView, from: number): void => {
  addLaps(acc.laps, view.state.history.laps.slice(from) as LapRecord[]);
};

const foldCrossings = (acc: Acc, view: EngineView, from: number): void => {
  const list = view.state.history.miniSectors;
  for (let i = from; i < list.length; i++) {
    const m = list[i] as MiniSectorCrossing;
    const byLap = (acc.crossings[m.carId] ??= new Map());
    let lap = byLap.get(m.lap);
    if (lap === undefined) byLap.set(m.lap, (lap = { at: [], latest: { segment: m.segment, at: m.at } }));
    lap.at[m.segment] = m.at;
    lap.latest = { segment: m.segment, at: m.at };
  }
};

/** What the view shows right now: cars, session and config (the history is folded separately). */
const snapshot = (acc: Acc, view: EngineView): void => {
  const { state } = view;
  acc.cars = state.cars.map((c) => ({ id: c.id, active: c.active, lap: c.timing.lap, driverStatus: c.timing.driverStatus, pitStatus: c.timing.pitStatus }));
  const s = state.session;
  acc.session = { kind: s.kind, sessionType: s.sessionType, numActiveCars: s.numActiveCars, timeLeftMs: s.timeLeftMs, updatedAt: s.updatedAt };
  const config = LAP_TIMES_CONFIG.read(view);
  acc.eliminated = { q1: config.eliminatedQ1, q2: config.eliminatedQ2 };
};

const init = (view: EngineView): Acc => {
  const acc = { laps: emptyCurrentLaps(), crossings: [] } as unknown as Acc;
  snapshot(acc, view);
  foldLaps(acc, view, 0);
  foldCrossings(acc, view, 0);
  return acc;
};

/** F1 25 session type codes (data-output spec, "Session types") of the knock-out parts with a cut-off. */
const SESSION_TYPE = { q1: 5, q2: 6, sprintShootout1: 10, sprintShootout2: 11 } as const;

/**
 * Cars this part knocks out, or `undefined` where there is no cut-off. F1 25 counts in `numActiveCars` only the cars
 * still in qualifying, so the cut-off of every part is `numActiveCars` minus the cars this part knocks out.
 */
const eliminatedIn = (acc: Acc): number | undefined => {
  const { sessionType } = acc.session;
  if (sessionType === SESSION_TYPE.q1 || sessionType === SESSION_TYPE.sprintShootout1) return acc.eliminated.q1;
  if (sessionType === SESSION_TYPE.q2 || sessionType === SESSION_TYPE.sprintShootout2) return acc.eliminated.q2;
  return undefined;
};

const TIMED: readonly SessionKind[] = ['practice', 'qualifying', 'sprintShootout'];

const notOnLap = (carId: CarId, cutOff: Projection['cutOff']): Projection => ({
  carId,
  onLap: false,
  projectedLapMs: notApplicable,
  deltaToBestMs: notApplicable,
  projectedPosition: notApplicable,
  cutOff,
  finishMarginMs: notApplicable,
});

const noProjection = (carId: CarId, cutOff: Projection['cutOff']): Projection => ({
  carId,
  onLap: true,
  projectedLapMs: insufficientData,
  deltaToBestMs: insufficientData,
  projectedPosition: insufficientData,
  cutOff,
  finishMarginMs: insufficientData,
});

/** The best laps of the active cars other than `id`. */
const othersBests = (acc: Acc, id: CarId, bests: Map<CarId, CarBests>): Best[] =>
  [...bests].filter(([other, b]) => other !== id && b.lap !== undefined && acc.cars[other]?.active === true).map(([, b]) => b.lap as Best);

/**
 * The quali cut-off from the other cars' bests alone, so it stands on an out lap and on the first flying lap too;
 * known since the newest of those bests. `margin` is the car's: from its projection, or why there is none.
 */
const cutOffOf = (acc: Acc, others: readonly Best[], margin: (timeMs: Ms) => Known<Ms>): Projection['cutOff'] => {
  const eliminated = acc.session.kind === 'qualifying' || acc.session.kind === 'sprintShootout' ? eliminatedIn(acc) : undefined;
  if (eliminated === undefined) return notApplicable;
  const cutPosition = acc.session.numActiveCars - eliminated;
  if (cutPosition < 1) return notApplicable;
  if (others.length < cutPosition) return insufficientData;
  const timeMs = ([...others].sort((a, b) => a.ms - b.ms)[cutPosition - 1] as Best).ms;
  const at = Math.max(...others.map((b) => b.completedAt));
  return known({ position: cutPosition, timeMs, marginMs: margin(timeMs) }, at);
};

const projectionOf = (acc: Acc, car: CarSnapshot, best: Best | undefined, bests: Map<CarId, CarBests>): Projection => {
  const id = car.id;
  const others = othersBests(acc, id, bests);
  const byLap = acc.laps[id] ?? {};
  const previous = byLap[car.lap - 1];
  if (car.driverStatus === 'inLap' || car.driverStatus === 'outLap' || car.driverStatus === 'inGarage' || car.pitStatus !== 'none' || previous?.inLap === true) {
    return notOnLap(id, cutOffOf(acc, others, () => notApplicable));
  }
  const bestLap = best === undefined ? undefined : byLap[best.lapNumber];
  const now = acc.crossings[id]?.get(car.lap);
  const bestAtSegment = best === undefined || now === undefined ? undefined : acc.crossings[id]?.get(best.lapNumber)?.at[now.latest.segment];
  if (best === undefined || bestLap === undefined || previous === undefined || now === undefined || bestAtSegment === undefined) {
    return noProjection(id, cutOffOf(acc, others, () => insufficientData));
  }

  const at = now.latest.at;
  const elapsed = at - previous.completedAt;
  const bestElapsed = bestAtSegment - (bestLap.completedAt - bestLap.lapTimeMs);
  const projected = elapsed + (best.ms - bestElapsed);
  const position = 1 + others.filter((b) => b.ms <= projected).length;
  // with a projection the cut-off is as of the latest crossing, like the margin
  const cut = cutOffOf(acc, others, (timeMs) => known(timeMs - projected, at));
  const cutOff: Projection['cutOff'] = cut.known ? known(cut.value, at) : cut;

  const finishMarginMs: Known<Ms> = TIMED.includes(acc.session.kind)
    ? known(acc.session.timeLeftMs - (at - acc.session.updatedAt) - (projected - elapsed), at)
    : notApplicable;

  return {
    carId: id,
    onLap: true,
    projectedLapMs: known(projected, at),
    deltaToBestMs: known(projected - best.ms, at),
    projectedPosition: known(position, at),
    cutOff,
    finishMarginMs,
  };
};

const output = (acc: Acc): LapTimesOutput => {
  const isRace = acc.session.kind === 'race';
  const lapsByCar = new Map<CarId, LapRecord[]>();
  acc.laps.forEach((byLap, i) => {
    if (byLap !== undefined) lapsByCar.set(toCarId(i), Object.values(byLap).sort((a, b) => a.lapNumber - b.lapNumber));
  });
  const bests = new Map<CarId, CarBests>();
  for (const [id, laps] of lapsByCar) bests.set(id, bestsOf(laps, isRace));
  const session = sessionBestsOf(bests);
  const rows: LapTimesOutput['rows'] = [];
  const projections: LapTimesOutput['projections'] = {};
  for (const car of acc.cars) {
    if (!car.active) continue;
    const carBests = bests.get(car.id) ?? { sectors: [undefined, undefined, undefined] };
    rows.push(rowOf(car.id, lapsByCar.get(car.id) ?? [], carBests, session, isRace));
    projections[car.id] = projectionOf(acc, car, carBests.lap, bests);
  }
  return { rows, sessionBest: sessionBestBoard(session), projections };
};

/** `lap-times`: a fold over the laps and the mini-sector crossings; the cars and session are read from the latest view. */
export const lapTimesCalculator: IncrementalCalculator<Acc, LapTimesOutput> = {
  id: LAP_TIMES,
  kind: 'incremental',
  reads: ['laps', 'miniSectors', 'timing', 'session'],
  cadence: 'frame',
  init,
  update(acc, delta, view) {
    if (delta.truncated) return init(view);
    snapshot(acc, view);
    foldLaps(acc, view, delta.before.laps);
    foldCrossings(acc, view, delta.before.miniSectors);
    return acc;
  },
  output,
};
