// The `lap-times` calculator: every car's last and best times, the session bests, and each car's projected lap (spec 6.2).
import {
  addLaps,
  carId as toCarId,
  emptyCurrentLaps,
  known,
  unknown,
  type CarId,
  type CurrentLaps,
  type Known,
  type LapRecord,
  type MiniSectorCrossing,
  type Ms,
  type Projection,
  type WeekendPhase,
} from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { behaviourByCar } from '../shared/behaviour.ts';
import { inSessionByCar } from '../shared/car-status.ts';
import { bestsOf, rowOf, sessionBestBoard, sessionBestsOf, type Best, type CarBests } from './lap-times.ts';
import { LAP_TIMES_BEHAVIOUR, type LapTimesEffect } from './behaviour.ts';
import { LAP_TIMES, LAP_TIMES_CONFIG, type LapTimesOutput } from './index.ts';

/** The crossings of one lap of one car: time by segment, and the newest. */
type LapCrossings = { at: number[]; latest: { segment: number; at: number } };

/** A car at the view: its lap and what the situations open for it say (their rows merged, C44). `inSession` is car-status not absent. */
type CarSnapshot = { id: CarId; inSession: boolean; lap: number; effect: LapTimesEffect };

/** The accumulator: a pure fold over the laps and the crossings (C31.2). */
type Acc = {
  laps: CurrentLaps;
  /** Per car, then lap number. */
  crossings: Array<Map<number, LapCrossings>>;
};

/** What the view shows right now: cars, session and config; read by `output`, never kept in the accumulator (C31.2). */
type Now = {
  cars: CarSnapshot[];
  session: { phase: WeekendPhase; timeLeftMs: Ms; updatedAt: number };
  eliminated: { q1: number; q2: number };
  /** The session and the `lap-classes` config, for `classifyLap`. */
  classes: LapClassOptions;
};

/** The fold and the view's now, as `output` combines them. */
type Board = Acc & Now;

const notApplicable = unknown('notApplicable');
const insufficientData = unknown('insufficientData');

const foldLaps = (acc: Acc, view: EngineView, from: number): void => {
  addLaps(acc.laps, view.history.laps.slice(from) as LapRecord[]);
};

const foldCrossings = (acc: Acc, view: EngineView, from: number): void => {
  const list = view.history.crossings;
  const length = list.length;
  for (let i = from; i < length; i++) {
    const m = list[i] as MiniSectorCrossing;
    const byLap = (acc.crossings[m.carId] ??= new Map());
    let lap = byLap.get(m.lap);
    if (lap === undefined) byLap.set(m.lap, (lap = { at: [], latest: { segment: m.segment, at: m.at } }));
    lap.at[m.segment] = m.at;
    // the accumulator's own object: no output holds it
    lap.latest.segment = m.segment;
    lap.latest.at = m.at;
  }
};

/** What the view shows right now: cars, session and config. Each machine's open spans are read once, by car. */
const nowOf = (view: EngineView): Now => {
  const { live } = view;
  const phase = view.situation.weekendPhase;
  const rowsOf = behaviourByCar(LAP_TIMES_BEHAVIOUR, view);
  const inSession = inSessionByCar(view);
  const cars = live.cars.map((c) => ({
    id: c.id,
    inSession: inSession(c.id),
    lap: c.timing.lap,
    // a pending phase has no span and nothing is projected until it is decided (C14, C3)
    effect: Object.assign({}, ...rowsOf(c.id), phase.kind === 'pending' ? { offLap: true } : {}) as LapTimesEffect,
  }));
  const s = live.session;
  const config = LAP_TIMES_CONFIG.read(view);
  return {
    cars,
    session: { phase, timeLeftMs: s.timeLeftMs, updatedAt: s.updatedAt },
    eliminated: { q1: config.eliminatedQ1, q2: config.eliminatedQ2 },
    classes: { isRace: phase.kind === 'race', ...LAP_CLASSES_CONFIG.read(view) },
  };
};

const init = (view: EngineView): Acc => {
  const acc: Acc = { laps: emptyCurrentLaps(), crossings: [] };
  foldLaps(acc, view, 0);
  foldCrossings(acc, view, 0);
  return acc;
};

/**
 * Cars this part knocks out, or `undefined` where there is no cut-off: the first and second part of a grand prix or
 * sprint shootout qualifying (the weekend phase's format and segment, C14); the last part and the short and one-shot
 * variants have none. Each part's cut-off counts the cars still in the session (`inSession`).
 */
const eliminatedIn = (acc: Board): number | undefined => {
  const { phase } = acc.session;
  if (phase.kind !== 'qualifying' || (phase.format !== 'grandPrix' && phase.format !== 'sprintShootout')) return undefined;
  if (phase.segment === 1) return acc.eliminated.q1;
  if (phase.segment === 2) return acc.eliminated.q2;
  return undefined;
};

const notOnLap = (carId: CarId, cutOff: Projection['cutOff']): Projection => ({
  carId,
  onLap: false,
  projectedLapMs: notApplicable,
  deltaToBestMs: notApplicable,
  projectedPosition: notApplicable,
  cutOff,
  finishMarginMs: notApplicable,
});

/** A car on its lap with no projection: `insufficientData` while one may still come, `notApplicable` once it cannot. */
const noProjection = (carId: CarId, cutOff: Projection['cutOff'], reason: Known<never> = insufficientData): Projection => ({
  carId,
  onLap: true,
  projectedLapMs: reason,
  deltaToBestMs: reason,
  projectedPosition: reason,
  cutOff,
  finishMarginMs: reason,
});

/** The best laps of the active cars other than `id`. */
const othersBests = (acc: Board, id: CarId, bests: Map<CarId, CarBests>): Best[] =>
  [...bests].filter(([other, b]) => other !== id && b.lap !== undefined && acc.cars[other]?.inSession === true).map(([, b]) => b.lap as Best);

/**
 * The quali cut-off from the other cars' bests alone, so it stands on an out lap and on the first flying lap too;
 * known since the newest of those bests. `margin` is the car's: from its projection, or why there is none.
 */
const cutOffOf = (acc: Board, others: readonly Best[], margin: (timeMs: Ms) => Known<Ms>): Projection['cutOff'] => {
  const eliminated = eliminatedIn(acc);
  if (eliminated === undefined) return notApplicable;
  const cutPosition = acc.cars.filter((c) => c.inSession).length - eliminated;
  if (cutPosition < 1) return notApplicable;
  if (others.length < cutPosition) return insufficientData;
  const timeMs = ([...others].sort((a, b) => a.ms - b.ms)[cutPosition - 1] as Best).ms;
  const at = Math.max(...others.map((b) => b.completedAt));
  return known({ position: cutPosition, timeMs, marginMs: margin(timeMs) }, at);
};

const projectionOf = (acc: Board, car: CarSnapshot, best: Best | undefined, bests: Map<CarId, CarBests>): Projection => {
  const id = car.id;
  const others = othersBests(acc, id, bests);
  const byLap = acc.laps[id] ?? {};
  const previous = byLap[car.lap - 1];
  // a car out of the race stays on its lap, where its projection will not come (wave 2, T7 ruling 2)
  if (car.effect.outOfRace) return noProjection(id, cutOffOf(acc, others, () => notApplicable), notApplicable);
  if (car.effect.offLap || previous?.inLap === true) {
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

  const finishMarginMs: Known<Ms> = car.effect.timed
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

const output = (fold: Acc, view: EngineView): LapTimesOutput => {
  const acc: Board = { ...fold, ...nowOf(view) };
  const lapsByCar = new Map<CarId, LapRecord[]>();
  acc.laps.forEach((byLap, i) => {
    if (byLap !== undefined) lapsByCar.set(toCarId(i), Object.values(byLap).sort((a, b) => a.lapNumber - b.lapNumber));
  });
  const bests = new Map<CarId, CarBests>();
  for (const [id, laps] of lapsByCar) bests.set(id, bestsOf(laps, acc.classes));
  const session = sessionBestsOf(bests);
  const rows: LapTimesOutput['rows'] = [];
  const projections: LapTimesOutput['projections'] = {};
  for (const car of acc.cars) {
    if (!car.inSession) continue;
    const carBests = bests.get(car.id) ?? { sectors: [undefined, undefined, undefined] };
    rows.push(rowOf(car.id, lapsByCar.get(car.id) ?? [], carBests, session, acc.classes, car.effect.outOfRace === true));
    projections[car.id] = projectionOf(acc, car, carBests.lap, bests);
  }
  return { rows, sessionBest: sessionBestBoard(session), projections };
};

/** `lap-times`: a fold over the laps and the mini-sector crossings; `output` reads the cars and session from the view. */
export const lapTimesCalculator: IncrementalCalculator<Acc, LapTimesOutput> = {
  id: LAP_TIMES,
  kind: 'incremental',
  reads: ['laps', 'miniSectors', 'timing', 'session', 'spans:weekend-phase', 'spans:car-status', 'spans:car-location', 'spans:car-activity-race', 'spans:car-activity-qualifying', 'spans:car-activity-practice'],
  cadence: 'frame',
  init,
  update(acc, delta, view) {
    if (delta.rewound !== undefined) return init(view);
    foldLaps(acc, view, delta.before.laps ?? 0);
    foldCrossings(acc, view, delta.before.crossings ?? 0);
    return acc;
  },
  output,
};
