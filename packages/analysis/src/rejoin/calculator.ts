// `rejoin` (SP4.2 spec 3.2): our car as if it were in the pit lane now, per condition (green, VSC, SC). The rejoin is
// the one stop-and-rejoin model's (`race-forecast`'s `rejoinOnRoad`, SP4.3c Task 17, O8): the stop costs the loss (less
// a human's saving), and our car yields at pit exit to a car crossing within `minGapMs`. For every other car X,
// `t_X = gapMs_X − rejoin` (its gap to us at the same point of the road, `gapsToCar`, minus our rejoin time); the
// physical order sorts by `t`, the ghost at 0. The map
// point is `rejoin-ghost`'s (SP4.3c §5.7, O18), from the loss output here. Quick (C31), race only (C14), our cars only.
import {
  known,
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
import type { QuickCalculator } from '@pitwall/engine/readers';
import { gapsToCar } from '../gaps/gaps.ts';
import { GAPS, type GapsOutput } from '../gaps/index.ts';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { RACE_INTERACTION_CONFIG } from '../race-interaction/config.ts';
import { rejoinOnRoad, stopCostOfLoss, type RoadAtLine } from '../race-forecast/index.ts';
import { behaviourByCar, behaviourFor } from '../shared/behaviour.ts';
import { latestTime, type CarCrossings } from '../shared/gapper-lines.ts';
import { ourCars } from '@pitwall/domain';
import { REJOIN_BEHAVIOUR } from './behaviour.ts';
import { REJOIN_CONFIG } from './config.ts';
import { REJOIN, type Rejoin, type RejoinOutput } from './index.ts';

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];
const NOT_APPLICABLE = unknown('notApplicable');
const INSUFFICIENT = unknown('insufficientData');

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
  ours: CarCrossings | undefined;
  position: number;
  carId: CarId;
  /** A human drives our car (its car-driver span): its stop is shorter (the stop model's). */
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

/** Our car under one condition: the one stop-and-rejoin model's rejoin (`race-forecast`, C43). */
function rejoinAt(condition: PitCondition, ctx: CarContext): RejoinAt {
  const { lossMs, source } = ctx.losses.conditions[condition];
  const base = { condition, lossMs, lossSource: source };
  if (!lossMs.known) return { ...base, rejoinPosition: lossMs, order: lossMs };
  const latest = ctx.ours === undefined ? undefined : latestTime(ctx.ours);
  if (ctx.gaps === undefined || ctx.ours === undefined || latest === undefined) return { ...base, rejoinPosition: INSUFFICIENT, order: INSUFFICIENT };
  const at = Math.max(latest, lossMs.at);
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
  reads: [{ calculator: GAPS }, { calculator: PIT_LOSS }, 'identity', 'timing', 'spans:weekend-phase', 'spans:car-activity-race', 'spans:car-status', 'spans:car-driver'],
  cadence: 'ourCrossing',
  compute: (view): RejoinOutput => {
    const gaps = view.outputs.get(GAPS) as GapsOutput | undefined;
    const losses = view.outputs.get(PIT_LOSS) as PitLosses | undefined;
    if (gaps === undefined || losses === undefined) throw new Error('rejoin: gaps and pit-loss run before it');
    const { ghostLaps, orderAround } = REJOIN_CONFIG.read(view);
    const mine = ourCars(view.live);
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
    for (const carId of mine) {
      const rows = rowsOf(carId);
      if (rows.some((row) => 'notApplicable' in row || ('car' in row && row.car !== 'running'))) continue;
      const position = positionOf(carId);
      // a car without a car-driver span is the AI's, as `driver-noise` reads it
      const human = driverOf(carId).some((row) => 'human' in row);
      const ctx: CarContext = { losses, gaps: gapsToCar(gaps, carId), outOfRace, ours: gaps.recent[carId], position, carId, human, minGapMs, positionOf, around: orderAround };
      cars[carId] = { carId, position, conditions: Object.fromEntries(CONDITIONS.map((c) => [c, rejoinAt(c, ctx)])) as Rejoin['conditions'] };
    }
    return { cars, ghost };
  },
};
