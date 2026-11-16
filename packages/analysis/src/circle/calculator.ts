// `circle` (SP4.3d spec §6.5): the field as a lap circle, per our car, on every frame. A car's place is how long ago our
// car was where that car is now, modulo one of our laps (ruling R10): its live progress moved into our last lap, read on
// our crossing history through the shared helper (`shared/crossing-history.ts`, C43). `lapMs` is our newest green lap
// (`lap-classes`' `forPace` over `currentLaps`, C25, C43). Our ghosts are `rejoin`'s, one per condition: its rejoin
// position and the intervals around the ghost in its order (never recomputed, C43), placed on the circle by the car
// ahead of the ghost (else the car behind). `current` is the race's session phase: an open `neutralised` span gives its
// car (`shared/neutralised.ts`), every other phase green. Quick (C31), race only (C14), our cars only.
import {
  currentLaps,
  known,
  MINI_SECTORS,
  ourCars,
  unknown,
  type CarId,
  type Circle,
  type CircleCar,
  type CircleGhost,
  type Known,
  type LapRecord,
  type Ms,
  type PitCondition,
  type RejoinAt,
  type SessionTime,
} from '@pitwall/domain';
import { openSpansOf, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { GAPS, type GapsOutput } from '../gaps/index.ts';
import { isPaceLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import { behaviourByCar, behaviourFor } from '../shared/behaviour.ts';
import { liveProgress, timeAtProgress, type LivePoint } from '../shared/crossing-history.ts';
import { latestOf } from '../shared/gapper-lines.ts';
import { neutralisationKind } from '../shared/neutralised.ts';
import { CIRCLE_BEHAVIOUR } from './behaviour.ts';
import { CIRCLE, type CircleOutput } from './id.ts';

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];
const NOT_APPLICABLE = unknown('notApplicable');
const INSUFFICIENT = unknown('insufficientData');
const NOT_RECEIVED = unknown('notReceived');

const WEEKEND_PHASE = { 'weekend-phase': CIRCLE_BEHAVIOUR['weekend-phase'] ?? {} };
const SESSION_PHASE = { 'session-phase-race': CIRCLE_BEHAVIOUR['session-phase-race'] ?? {} };
const CAR_ROWS = { 'car-status': CIRCLE_BEHAVIOUR['car-status'] ?? {} };

/** The race's condition now: an open `neutralised` span's car, else green. */
function currentOf(view: EngineView): PitCondition {
  if (!behaviourFor(SESSION_PHASE, view).some((row) => 'neutralised' in row)) return 'green';
  const span = openSpansOf(view, 'session-phase-race').find((s) => s.kind === 'neutralised');
  if (span === undefined) return 'green';
  const kind = neutralisationKind(span);
  return kind === 'SC' ? 'sc' : kind === 'VSC' ? 'vsc' : 'green';
}

/** Our newest green lap (`forPace`, over the current laps, C25): its time, known since it was completed. */
function lastGreenLap(laps: readonly LapRecord[], carId: CarId, classes: LapClassOptions): Known<Ms> {
  const current = currentLaps(laps.filter((l) => l.carId === carId));
  for (let i = current.length - 1; i >= 0; i--) {
    const lap = current[i] as LapRecord;
    if (isPaceLap(lap, classes)) return known(lap.lapTimeMs, lap.completedAt);
  }
  return INSUFFICIENT;
}

/**
 * Every other running car's time behind our car now, modulo one of our laps: its live progress moved by whole laps
 * into our last lap (`(here − 1 lap, here]`), and how long ago we were there on our crossing history (the shared helper,
 * C43). A car without a crossing or a live position has no place. `insufficientData` when our car has no crossing.
 */
function placesOf(view: EngineView, gaps: GapsOutput, carId: CarId, running: (id: CarId) => boolean, now: SessionTime): Known<CircleCar[]> {
  const ours = gaps.recent[carId];
  if (ours === undefined || ours.at.length === 0) return INSUFFICIENT;
  const lengthM = view.live.session.trackLengthM;
  const liveOf = (id: CarId): Known<number> => {
    const timing = view.live.cars[id]?.timing;
    return timing === undefined ? NOT_RECEIVED : liveProgress(timing.lap, timing.lapDistanceM, lengthM, now);
  };
  const newest = latestOf(ours);
  const live = liveOf(carId);
  const here = live.known && live.value > newest ? live.value : newest;
  const livePoint: LivePoint = { t: now, progress: here };
  const cars: CircleCar[] = [];
  for (const { carId: id } of gaps.intervals) {
    if (id === carId || gaps.recent[id] === undefined || !running(id)) continue;
    const progress = liveOf(id);
    if (!progress.known) continue;
    const back = (((here - progress.value) % MINI_SECTORS) + MINI_SECTORS) % MINI_SECTORS;
    const t = timeAtProgress(ours, here - back, livePoint);
    if (t.known) cars.push({ carId: id, behindMs: Math.round(now - t.value) });
  }
  return known(cars, now);
}

/** Our ghost under one condition: `rejoin`'s rejoin position and the intervals around its ghost row, on the circle. */
function ghostOf(at: RejoinAt, places: ReadonlyMap<CarId, Ms>, now: SessionTime): CircleGhost {
  const { condition, rejoinPosition, order } = at;
  if (!order.known) return { condition, behindMs: order, rejoinPosition, aheadMs: order, behindCarMs: order };
  const rows = order.value;
  const g = rows.findIndex((r) => r.ghost);
  const row = rows[g];
  if (row === undefined) return { condition, behindMs: INSUFFICIENT, rejoinPosition, aheadMs: INSUFFICIENT, behindCarMs: INSUFFICIENT };
  const ahead = rows[g - 1];
  const behind = rows[g + 1];
  const aheadMs = row.intervalMs;
  const behindCarMs: Known<Ms> = behind === undefined ? NOT_APPLICABLE : behind.intervalMs;
  const aheadAt = ahead === undefined ? undefined : places.get(ahead.carId);
  const behindAt = behind === undefined ? undefined : places.get(behind.carId);
  const behindMs: Known<Ms> =
    aheadAt !== undefined && aheadMs.known
      ? known(aheadAt + aheadMs.value, now)
      : behindAt !== undefined && behindCarMs.known
        ? known(behindAt - behindCarMs.value, now)
        : INSUFFICIENT;
  return { condition, behindMs, rejoinPosition, aheadMs, behindCarMs };
}

export const circleCalculator: QuickCalculator<CircleOutput> = {
  id: CIRCLE,
  kind: 'quick',
  reads: [{ calculator: GAPS }, { calculator: REJOIN }, 'laps', 'identity', 'timing', 'session', 'spans:weekend-phase', 'spans:session-phase-race', 'spans:car-status'],
  cadence: 'frame',
  compute: (view): CircleOutput => {
    const gaps = view.outputs.get(GAPS) as GapsOutput | undefined;
    const rejoin = view.outputs.get(REJOIN) as RejoinOutput | undefined;
    if (gaps === undefined || rejoin === undefined) throw new Error('circle: gaps and rejoin run before it');
    const cars: Record<CarId, Circle> = {};
    // a pending weekend phase has no span and reads as the race (C14)
    if (behaviourFor(WEEKEND_PHASE, view).some((row) => 'notApplicable' in row)) return { cars };
    const rowsOf = behaviourByCar(CAR_ROWS, view);
    const running = (id: CarId): boolean => !rowsOf(id).some((row) => 'car' in row && row.car !== 'running');
    const now = view.live.sessionTime;
    const current = currentOf(view);
    const classes: LapClassOptions = { isRace: true, ...LAP_CLASSES_CONFIG.read(view) };
    const laps = view.history.laps as readonly LapRecord[];
    for (const carId of ourCars(view.live)) {
      if (!running(carId)) continue;
      const placed = placesOf(view, gaps, carId, running, now);
      const places = new Map<CarId, Ms>(placed.known ? placed.value.map((c) => [c.carId, c.behindMs]) : []);
      const r = rejoin.cars[carId];
      const ghosts = r === undefined ? [] : CONDITIONS.map((c) => ghostOf(r.conditions[c], places, now));
      cars[carId] = { carId, lapMs: lastGreenLap(laps, carId, classes), cars: placed, ghosts, current };
    }
    return { cars };
  },
};
