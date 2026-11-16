// `circle` (SP4.3d spec §6.5): the field as a lap circle, per our car, on every frame. A car's place is how long ago our
// car was where that car is now, folded into one of our laps: the shared `timeBehind`'s `wrappedMs` on our crossing
// history (`shared/crossing-history.ts`, C43, R14). One turn, `lapMs`, is our rolling lap (R15), so no place lies past
// it. Our ghosts are `rejoin`'s, one per condition: each sits `rejoin`'s loss for its condition behind us, folded into
// our rolling lap (R16), with its rejoin position and the intervals around the ghost in its order (never recomputed,
// C43). `current` is the race's session phase: an open `neutralised` span gives its car (`shared/neutralised.ts`), every
// other phase green. Quick (C31), race only (C14), our cars only.
import {
  known,
  ourCars,
  unknown,
  type CarId,
  type Circle,
  type CircleCar,
  type CircleGhost,
  type Known,
  type Ms,
  type PitCondition,
  type RejoinAt,
  type SessionTime,
} from '@pitwall/domain';
import { openSpansOf, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { GAPS, type GapsOutput } from '../gaps/index.ts';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import { behaviourByCar, behaviourFor } from '../shared/behaviour.ts';
import { liveProgress, rollingLap, timeBehind } from '../shared/crossing-history.ts';
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

/** One turn of the circle and every other running car's place on it, per our car. */
type Places = { lapMs: Known<Ms>; cars: Known<CircleCar[]> };

/**
 * Our rolling lap and every other running car's time behind our car now, folded into it (the shared `timeBehind`'s
 * `wrappedMs` and `lapMs`, C43). A car without a crossing or a live position has no place. Both `insufficientData`
 * without a lap of our crossing history.
 */
function placesOf(view: EngineView, gaps: GapsOutput, carId: CarId, running: (id: CarId) => boolean, now: SessionTime): Places {
  const ours = gaps.recent[carId];
  if (ours === undefined) return { lapMs: INSUFFICIENT, cars: INSUFFICIENT };
  const lengthM = view.live.session.trackLengthM;
  const progressNow = (id: CarId): Known<number> => {
    const timing = view.live.cars[id]?.timing;
    return timing === undefined ? NOT_RECEIVED : liveProgress(timing.lap, timing.lapDistanceM, lengthM, now);
  };
  const ourLive = progressNow(carId);
  const lapMs = rollingLap(ours, ourLive, now);
  if (!lapMs.known) return { lapMs, cars: lapMs };
  const cars: CircleCar[] = [];
  for (const { carId: id } of gaps.intervals) {
    if (id === carId || gaps.recent[id] === undefined || !running(id)) continue;
    const progress = progressNow(id);
    if (!progress.known) continue;
    const b = timeBehind(ours, ourLive, progress.value, now);
    if (b.known) cars.push({ carId: id, behindMs: b.value.wrappedMs });
  }
  return { lapMs, cars: known(cars, now) };
}

/**
 * Our ghost under one condition: it sits `rejoin`'s loss behind us, folded into our rolling lap (R16, C43), with
 * `rejoin`'s rejoin position and the intervals around its ghost row (never recomputed).
 */
function ghostOf(at: RejoinAt, lapMs: Known<Ms>, now: SessionTime): CircleGhost {
  const { condition, lossMs, rejoinPosition, order } = at;
  const behindMs: Known<Ms> = !lossMs.known ? lossMs : !lapMs.known ? lapMs : known(Math.round(((lossMs.value % lapMs.value) + lapMs.value) % lapMs.value), now);
  if (!order.known) return { condition, behindMs, rejoinPosition, aheadMs: order, behindCarMs: order };
  const rows = order.value;
  const row = rows.find((r) => r.ghost);
  if (row === undefined) return { condition, behindMs, rejoinPosition, aheadMs: INSUFFICIENT, behindCarMs: INSUFFICIENT };
  const behind = rows[rows.indexOf(row) + 1];
  return { condition, behindMs, rejoinPosition, aheadMs: row.intervalMs, behindCarMs: behind === undefined ? NOT_APPLICABLE : behind.intervalMs };
}

export const circleCalculator: QuickCalculator<CircleOutput> = {
  id: CIRCLE,
  kind: 'quick',
  reads: [{ calculator: GAPS }, { calculator: REJOIN }, 'identity', 'timing', 'session', 'spans:weekend-phase', 'spans:session-phase-race', 'spans:car-status'],
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
    for (const carId of ourCars(view.live)) {
      if (!running(carId)) continue;
      const { lapMs, cars: placed } = placesOf(view, gaps, carId, running, now);
      const r = rejoin.cars[carId];
      const ghosts = r === undefined ? [] : CONDITIONS.map((c) => ghostOf(r.conditions[c], lapMs, now));
      cars[carId] = { carId, lapMs, cars: placed, ghosts, current };
    }
    return { cars };
  },
};
