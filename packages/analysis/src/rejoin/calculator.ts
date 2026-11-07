// `rejoin` (SP4.2 spec 3.2): our car as if it were in the pit lane now, per condition (green, VSC, SC). For every other
// car X, `t_X = gapMs_X − loss` (its gap to us at the same point of the road, `gapsToCar`, minus the loss); the physical
// order sorts by `t`, the ghost at 0; the rejoin position counts the cars on our lap behind us within the loss; the map
// point is where we were `loss` ms ago, on the track file's outline (C62b). Quick (C31), race only (C14), our cars only.
import {
  known,
  MINI_SECTORS,
  unknown,
  type CarId,
  type CrossingRow,
  type GapToCar,
  type Known,
  type MapPoint,
  type Ms,
  type PitCondition,
  type PitLosses,
  type RejoinAt,
  type SessionTime,
} from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { gapsToCar } from '../gaps/gaps.ts';
import { GAPS, type GapsOutput } from '../gaps/index.ts';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { behaviourByCar, behaviourFor } from '../shared/behaviour.ts';
import { latestTime, type CarCrossings } from '../shared/gapper-lines.ts';
import { ourCars } from '../shared/our-cars.ts';
import { pointAt } from '../shared/track-lookup.ts';
import { REJOIN_BEHAVIOUR } from './behaviour.ts';
import { REJOIN_CONFIG } from './config.ts';
import { REJOIN, type Rejoin, type RejoinOutput } from './index.ts';

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];
const NOT_APPLICABLE = unknown('notApplicable');
const INSUFFICIENT = unknown('insufficientData');

const WEEKEND_PHASE = { 'weekend-phase': REJOIN_BEHAVIOUR['weekend-phase'] ?? {} };
const CAR_ROWS = { 'car-activity-race': REJOIN_BEHAVIOUR['car-activity-race'] ?? {}, 'car-status': REJOIN_BEHAVIOUR['car-status'] ?? {} };

/** Another car with a known gap to ours at the same point of the road, and its `t` under the loss. */
type Other = { carId: CarId; position: number; gapMs: Ms; lapsDown: number; t: Ms };

type Outline = Known<readonly DeepReadonly<MapPoint>[]>;

/** The outline of the view's track file; `notApplicable` without one or without its outline. */
function outlineOf(view: EngineView): Outline {
  if (!view.track.known) return NOT_APPLICABLE;
  const outline = view.track.value.outline;
  return outline.known && outline.value.length > 0 ? known(outline.value, view.track.at) : NOT_APPLICABLE;
}

/**
 * Where our car was at `t`, as an outline point: our progress interpolated between our two crossings around `t`, its
 * part within its lap over 50 as the lap fraction. `insufficientData` when our kept crossings begin after `t`.
 */
function mapPointAt(ours: CarCrossings, t: SessionTime, outline: readonly DeepReadonly<MapPoint>[], at: SessionTime): Known<MapPoint> {
  const first = ours.at.findIndex((x) => x !== undefined);
  if (first < 0 || (ours.at[first] as SessionTime) > t) return INSUFFICIENT;
  let i = first;
  for (let j = first + 1; j < ours.at.length; j++) {
    const x = ours.at[j];
    if (x === undefined) continue;
    if (x > t) {
      const from = ours.at[i] as SessionTime;
      const progress = ours.fromProgress + i + ((j - i) * (t - from)) / (x - from);
      return known(pointAt(outline, (progress % MINI_SECTORS) / MINI_SECTORS), at);
    }
    i = j;
  }
  return known(pointAt(outline, ((ours.fromProgress + i) % MINI_SECTORS) / MINI_SECTORS), at);
}

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

/** Whether a car behind us on our lap rejoins behind the ghost: a stop costs it. */
const passedBy = (gap: Pick<Other, 'gapMs' | 'lapsDown'>, lossMs: Ms): boolean => gap.lapsDown === 0 && gap.gapMs > 0 && gap.gapMs < lossMs;

/** Our car under one condition. */
function rejoinAt(
  condition: PitCondition,
  ctx: { losses: PitLosses; gaps: readonly GapToCar[] | undefined; ours: CarCrossings | undefined; position: number; carId: CarId; positionOf: (id: CarId) => number; outline: Outline; around: number },
): RejoinAt {
  const { lossMs, source } = ctx.losses.conditions[condition];
  const base = { condition, lossMs, lossSource: source };
  if (!lossMs.known) return { ...base, rejoinPosition: lossMs, order: lossMs, mapPoint: lossMs };
  const latest = ctx.ours === undefined ? undefined : latestTime(ctx.ours);
  if (ctx.gaps === undefined || ctx.ours === undefined || latest === undefined) return { ...base, rejoinPosition: INSUFFICIENT, order: INSUFFICIENT, mapPoint: INSUFFICIENT };
  const at = Math.max(latest, lossMs.at);
  const loss = lossMs.value;
  const others: Other[] = [];
  for (const g of ctx.gaps) {
    if (g.carId === ctx.carId || !g.gapMs.known) continue;
    const current = ctx.positionOf(g.carId);
    const gap = { gapMs: g.gapMs.value, lapsDown: g.lapsDown };
    // positions at pit exit: a car that passes us while we stop gains one place
    others.push({ carId: g.carId, ...gap, t: g.gapMs.value - loss, position: passedBy(gap, loss) ? current - 1 : current });
  }
  const rejoinPosition = ctx.position + others.filter((o) => passedBy(o, loss)).length;  const mapPoint = ctx.outline.known ? mapPointAt(ctx.ours, latest - loss, ctx.outline.value, at) : ctx.outline;
  return { ...base, rejoinPosition: known(rejoinPosition, at), order: known(orderOf(others, ctx.carId, rejoinPosition, ctx.around, at), at), mapPoint };
}

export const rejoinCalculator: QuickCalculator<RejoinOutput> = {
  id: REJOIN,
  kind: 'quick',
  reads: [{ calculator: GAPS }, { calculator: PIT_LOSS }, 'identity', 'timing', 'spans:weekend-phase', 'spans:car-activity-race', 'spans:car-status'],
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
    const outline = outlineOf(view);
    const positionOf = (id: CarId): number => view.live.cars[id]?.timing.position ?? 0;
    for (const carId of mine) {
      const rows = rowsOf(carId);
      if (rows.some((row) => 'notApplicable' in row || ('car' in row && row.car !== 'running'))) continue;
      const position = positionOf(carId);
      const ctx = { losses, gaps: gapsToCar(gaps, carId), ours: gaps.recent[carId], position, carId, positionOf, outline, around: orderAround };
      cars[carId] = { carId, position, conditions: Object.fromEntries(CONDITIONS.map((c) => [c, rejoinAt(c, ctx)])) as Rejoin['conditions'] };
    }
    return { cars, ghost };
  },
};
