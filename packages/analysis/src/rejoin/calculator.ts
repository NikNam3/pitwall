// `rejoin` (SP4.2 spec 3.2): our car as if it were in the pit lane now, per condition (green, VSC, SC). The rejoin is
// the one stop-and-rejoin model's (`race-forecast`'s `rejoinOnRoad`, SP4.3c Task 17, O8): the stop costs the loss (less
// a human's saving), and our car yields at pit exit to a car crossing within `minGapMs`. For every other car X,
// `t_X = gapMs_X − rejoin` (its time behind us now on our crossing history, SP4.3d spec §6.5, minus our rejoin time);
// the physical order sorts by `t`, the ghost at 0. On every frame, so a car that stops slides back at once. The map
// point is `rejoin-ghost`'s (SP4.3c §5.7, O18), from the loss output here. Quick (C31), race only (C14), our cars only.
import {
  known,
  MINI_SECTORS,
  unknown,
  type CarId,
  type CrossingRow,
  type GapToCar,
  type Known,
  type Ms,
  type PitCondition,
  type PitLosses,
  type RejoinAt,
  type SessionTime,
} from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { GAPS, type GapsOutput } from '../gaps/index.ts';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { RACE_INTERACTION_CONFIG } from '../race-interaction/config.ts';
import { rejoinOnRoad, stopCostOfLoss, type RoadAtLine } from '../race-forecast/index.ts';
import { behaviourByCar, behaviourFor } from '../shared/behaviour.ts';
import { FORECAST_FIELD_CONFIG } from '../shared/forecast-field/config.ts';
import { liveProgress, timeAtProgress } from '../shared/crossing-history.ts';
import { latestOf, latestTime } from '../shared/gapper-lines.ts';
import { isHumanDriver } from '../shared/human-driver.ts';
import { ourCars } from '@pitwall/domain';
import { REJOIN_BEHAVIOUR } from './behaviour.ts';
import { REJOIN_CONFIG } from './config.ts';
import { REJOIN, type Rejoin, type RejoinOutput } from './index.ts';

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];
const NOT_APPLICABLE = unknown('notApplicable');
const INSUFFICIENT = unknown('insufficientData');
const NOT_RECEIVED = unknown('notReceived');

const WEEKEND_PHASE = { 'weekend-phase': REJOIN_BEHAVIOUR['weekend-phase'] ?? {} };
const CAR_ROWS = { 'car-activity-race': REJOIN_BEHAVIOUR['car-activity-race'] ?? {}, 'car-status': REJOIN_BEHAVIOUR['car-status'] ?? {} };
const DRIVER_ROWS = { 'car-driver': REJOIN_BEHAVIOUR['car-driver'] ?? {} };

/** Another car with a known gap to ours at the same point of the road, and its `t` under the loss. */
type Other = { carId: CarId; position: number; gapMs: Ms; lapsDown: number; t: Ms };

/** The rows around the ghost: `around` either side, each with its interval to the row ahead in the full order. */
function orderOf(others: readonly Other[], ourCarId: CarId, rejoinPosition: number, around: number, at: SessionTime): CrossingRow[] {
  const sorted = [...others].sort((a, b) => a.t - b.t || a.position - b.position);
  const ghostAt = sorted.filter((o) => o.t < 0).length;
  const full = [...sorted.slice(0, ghostAt).map((o) => ({ ...o, ghost: false })), { carId: ourCarId, position: rejoinPosition, t: 0, ghost: true }, ...sorted.slice(ghostAt).map((o) => ({ ...o, ghost: false }))];
  const from = Math.max(0, ghostAt - around);
  const to = Math.min(full.length, ghostAt + around + 1);
  const rows: CrossingRow[] = [];
  for (let k = from; k < to; k++) {
    const row = full[k] as (typeof full)[number];
    const ahead = full[k - 1];
    rows.push({ carId: row.carId, position: row.position, intervalMs: ahead === undefined ? NOT_APPLICABLE : known(row.t - ahead.t, at), ghost: row.ghost });
  }
  return rows;
}

/** What every condition of one car reads. */
type CarContext = {
  losses: PitLosses;
  gaps: readonly GapToCar[] | undefined;
  /** The cars out of the race (`gaps`' `outOfRace`): nobody's neighbour. */
  outOfRace: ReadonlySet<CarId>;
  /** The frame's time. */
  now: SessionTime;
  position: number;
  carId: CarId;
  /** A human drives our car (`isHumanDriver`): its stop is shorter (the stop model's). */
  human: boolean;
  /** `race-interaction`'s minimum following gap: the pit-exit yield's window. */
  minGapMs: Ms;
  positionOf: (id: CarId) => number;
  around: number;
};

/**
 * The road at our line as the stop model reads it (`race-forecast`'s `rejoinOnRoad`): per car its time behind ours
 * (our car 0); a car laps ahead or behind, or on our lap without a known gap, by its place at ±Infinity.
 */
function roadOf(gaps: readonly GapToCar[], ctx: CarContext): { road: RoadAtLine; car: number } {
  const timeMs: number[] = [0];
  const retired: number[] = [0];
  for (const g of gaps) {
    if (g.carId === ctx.carId) continue;
    const out = ctx.outOfRace.has(g.carId);
    const behind = g.lapsDown > 0 || (g.lapsDown === 0 && !g.gapMs.known && ctx.positionOf(g.carId) > ctx.position);
    timeMs.push(g.lapsDown === 0 && g.gapMs.known ? g.gapMs.value : behind ? Infinity : -Infinity);
    retired.push(out ? 1 : 0);
  }
  return { road: { timeMs, retired }, car: 0 };
}

/**
 * Every other car's time behind our car now on our crossing history (spec §6.5, the helper `shared/crossing-history.ts`,
 * C43), shaped as `gapsToCar`'s rows: a car at progress `p` on our lap, behind us, is `now − (when we were at p)`
 * behind; a car ahead on our lap is minus the time we took, a lap ago, from where we are now to where it is; the laps
 * between (`lapsDown`, signed) are counted from the progress difference, as `gaps` counts them, and a lapped car's time
 * is taken that many laps on. A car without a crossing, and a car out of the race, has no time (as `gapsToCar`).
 * `undefined` when our car is no running car of `gaps` or has no crossing.
 */
function liveGaps(view: EngineView, gaps: GapsOutput, carId: CarId, now: SessionTime): GapToCar[] | undefined {
  const ours = gaps.recent[carId];
  if (ours === undefined || !gaps.intervals.some((i) => i.carId === carId)) return undefined;
  const newestTime = latestTime(ours);
  if (newestTime === undefined) return undefined;
  const lengthM = view.live.session.trackLengthM;
  const liveOf = (id: CarId): Known<number> => {
    const timing = view.live.cars[id]?.timing;
    return timing === undefined ? NOT_RECEIVED : liveProgress(timing.lap, timing.lapDistanceM, lengthM, now);
  };
  const newest = latestOf(ours);
  const live = liveOf(carId);
  // where we are now: our live progress, never before our newest crossing
  const here = live.known && live.value > newest ? live.value : newest;
  // when we were at `p`: our crossing history, up to our live point (the helper's tail, C43)
  const livePoint = { t: now, progress: here };
  const sinceThere = (p: number): Known<Ms> => {
    const t = timeAtProgress(ours, p, livePoint);
    return t.known ? known(Math.round(now - t.value), now) : t;
  };
  const lapAgo = timeAtProgress(ours, here - MINI_SECTORS, livePoint);
  const rows: GapToCar[] = [];
  for (const i of gaps.intervals) {
    if (i.carId === carId) {
      rows.push({ carId, gapMs: NOT_APPLICABLE, lapsDown: 0 });
      continue;
    }
    const progress = liveOf(i.carId);
    if (gaps.recent[i.carId] === undefined || !progress.known) {
      rows.push({ carId: i.carId, gapMs: NOT_RECEIVED, lapsDown: 0 });
      continue;
    }
    const p = progress.value;
    if (p <= here) {
      const down = Math.floor((here - p) / MINI_SECTORS);
      rows.push({ carId: i.carId, gapMs: sinceThere(p + down * MINI_SECTORS), lapsDown: down });
      continue;
    }
    const up = Math.floor((p - here) / MINI_SECTORS);
    const there = timeAtProgress(ours, p - (up + 1) * MINI_SECTORS, livePoint);
    const gapMs = there.known && lapAgo.known ? known(Math.round(lapAgo.value - there.value), now) : there.known ? lapAgo : there;
    rows.push({ carId: i.carId, gapMs, lapsDown: 0 - up });
  }
  for (const id of gaps.outOfRace) rows.push({ carId: id, gapMs: NOT_APPLICABLE, lapsDown: 0 });
  return rows;
}

/** Our car under one condition: the one stop-and-rejoin model's rejoin (`race-forecast`, C43). */
function rejoinAt(condition: PitCondition, ctx: CarContext): RejoinAt {
  const { lossMs, source } = ctx.losses.conditions[condition];
  const base = { condition, lossMs, lossSource: source };
  if (!lossMs.known) return { ...base, rejoinPosition: lossMs, order: lossMs };
  if (ctx.gaps === undefined) return { ...base, rejoinPosition: INSUFFICIENT, order: INSUFFICIENT };
  const at = Math.max(ctx.now, lossMs.at);
  const costMs = stopCostOfLoss(lossMs.value, ctx.human);
  const { road, car } = roadOf(ctx.gaps, ctx);
  const { position: rejoinPosition, rejoinMs } = rejoinOnRoad(road, car, costMs, ctx.minGapMs);
  const others: Other[] = [];
  for (const g of ctx.gaps) {
    if (g.carId === ctx.carId || !g.gapMs.known) continue;
    const current = ctx.positionOf(g.carId);
    // positions at pit exit: a car on our lap behind us that crosses before our rejoin gains one place
    const gains = g.lapsDown === 0 && g.gapMs.value > 0 && g.gapMs.value < rejoinMs;
    others.push({ carId: g.carId, gapMs: g.gapMs.value, lapsDown: g.lapsDown, t: g.gapMs.value - rejoinMs, position: gains ? current - 1 : current });
  }
  return { ...base, rejoinPosition: known(rejoinPosition, at), order: known(orderOf(others, ctx.carId, rejoinPosition, ctx.around, at), at) };
}

export const rejoinCalculator: QuickCalculator<RejoinOutput> = {
  id: REJOIN,
  kind: 'quick',
  reads: [{ calculator: GAPS }, { calculator: PIT_LOSS }, 'identity', 'timing', 'session', 'spans:weekend-phase', 'spans:car-activity-race', 'spans:car-status', 'spans:car-driver'],
  cadence: 'frame',
  compute: (view): RejoinOutput => {
    const gaps = view.outputs.get(GAPS) as GapsOutput | undefined;
    const losses = view.outputs.get(PIT_LOSS) as PitLosses | undefined;
    if (gaps === undefined || losses === undefined) throw new Error('rejoin: gaps and pit-loss run before it');
    const { ghostLaps, orderAround } = REJOIN_CONFIG.read(view);
    const mine = ourCars(view.live);
    const now = view.live.sessionTime;
    const ghost = { gaps, losses: Object.fromEntries(CONDITIONS.map((c) => [c, losses.conditions[c].lossMs])) as Record<PitCondition, Known<Ms>>, ourCars: mine, ghostLaps };
    const cars: Record<CarId, Rejoin> = {};
    // a pending weekend phase has no span and reads as the race (C14)
    if (behaviourFor(WEEKEND_PHASE, view).some((row) => 'notApplicable' in row)) return { cars, ghost };
    const rowsOf = behaviourByCar(CAR_ROWS, view);
    const driverOf = behaviourByCar(DRIVER_ROWS, view);
    const positionOf = (id: CarId): number => view.live.cars[id]?.timing.position ?? 0;
    const outOfRace = new Set(gaps.outOfRace);
    // the pit-exit yield's window: race-interaction's minimum following gap, the starting point's too
    const { minGapMs } = RACE_INTERACTION_CONFIG.read(view);
    // a car without a car-driver span: forecast-field's key, the starting point's too (C43, C47)
    const { unknownDriverIsHuman } = FORECAST_FIELD_CONFIG.read(view);
    for (const carId of mine) {
      const rows = rowsOf(carId);
      if (rows.some((row) => 'notApplicable' in row || ('car' in row && row.car !== 'running'))) continue;
      const position = positionOf(carId);
      // who drives our car: its car-driver span, else forecast-field's rule for a car without one (R55)
      const kind = driverOf(carId).find((row) => 'driver' in row && row.driver !== undefined);
      const human = isHumanDriver(kind !== undefined && 'driver' in kind ? kind.driver : undefined, unknownDriverIsHuman);
      const ctx: CarContext = { losses, gaps: liveGaps(view, gaps, carId, now), outOfRace, now, position, carId, human, minGapMs, positionOf, around: orderAround };
      cars[carId] = { carId, position, conditions: Object.fromEntries(CONDITIONS.map((c) => [c, rejoinAt(c, ctx)])) as Rejoin['conditions'] };
    }
    return { cars, ghost };
  },
};
