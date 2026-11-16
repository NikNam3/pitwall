// The loss of one stop (spec 4.3, TUM): in-lap + out-lap − 2 × the car's reference lap before the stop (`pace-delta`'s
// `referencePaceMs`, SP4.3c O12); the stationary time above the session's median is removed and kept apart. Shared by
// the calculator (this session's stops) and the priors aggregate (each source session's stops).
import { known, unknown, type CarId, type Known, type LapRecord, type Ms, type PitLossStop, type PitStopRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import type { LapClassOptions } from '../lap-classes/index.ts';
import { referencePaceMs } from '../pace-delta/index.ts';
import { median } from '../shared/stats.ts';
import type { PIT_LOSS_CONFIG } from './config.ts';

/** The effective `pit-loss` config (C47). */
export type PitLossConfig = typeof PIT_LOSS_CONFIG.defaults;

/**
 * The `pit-loss` config with the reference window (`pace-delta.windowLaps`) and the `classifyLap` options of the stops'
 * session (its weekend phase and `lap-classes`' config).
 */
export type PitLossOptions = PitLossConfig & { window: number; classes: LapClassOptions };

/** A stop's in-lap and out-lap and the car's reference lap (`referencePaceMs` before the in-lap). */
type StopLaps = { inLap: DeepReadonly<LapRecord>; outLap: DeepReadonly<LapRecord>; referenceMs: Ms };

/** The laps of `stop` among `carLaps` (only the stop's car's are used); without an in-lap, an out-lap or a reference lap: none. */
function stopLaps(stop: DeepReadonly<PitStopRecord>, carLaps: readonly DeepReadonly<LapRecord>[], opts: PitLossOptions): StopLaps | undefined {
  const byNumber = new Map<number, DeepReadonly<LapRecord>>();
  for (const lap of carLaps) if (lap.carId === stop.carId) byNumber.set(lap.lapNumber, lap);
  const inLap = byNumber.get(stop.lap);
  const outLap = byNumber.get(stop.lap + 1);
  const reference = referencePaceMs([...byNumber.values()], stop.lap, { window: opts.window, ...opts.classes });
  if (inLap === undefined || outLap === undefined || !reference.known) return undefined;
  return { inLap, outLap, referenceMs: reference.value };
}

/**
 * A stop's TUM loss before the stationary correction: in-lap (`lapNumber === stop.lap`) + out-lap (`stop.lap + 1`) − 2 ×
 * the car's reference lap: `referencePaceMs`, the mean of its last `window` pace laps before the in-lap. `carLaps` are
 * current laps (`currentLaps`, C25); only the stop's car's are used. Without an in-lap, an out-lap or a pace lap before
 * the in-lap: `insufficientData`.
 */
export function stopLoss(stop: DeepReadonly<PitStopRecord>, carLaps: readonly DeepReadonly<LapRecord>[], opts: PitLossOptions): Known<Ms> {
  const laps = stopLaps(stop, carLaps, opts);
  if (laps === undefined) return unknown('insufficientData');
  return known(Math.round(laps.inLap.lapTimeMs + laps.outLap.lapTimeMs - 2 * laps.referenceMs), laps.outLap.completedAt);
}

/**
 * The share of a stop's loss `lossMs` paid on its in-lap (SP4.3b Task 11c): (in-lap − the car's reference lap) / the
 * loss. Without the stop's laps, or with a loss that is not positive: none.
 */
export function inLapShareOf(stop: DeepReadonly<PitStopRecord>, carLaps: readonly DeepReadonly<LapRecord>[], lossMs: Ms, opts: PitLossOptions): number | undefined {
  const laps = stopLaps(stop, carLaps, opts);
  if (laps === undefined || lossMs <= 0) return undefined;
  return (laps.inLap.lapTimeMs - laps.referenceMs) / lossMs;
}

/**
 * Every stop of a session with its loss, in lap order: the TUM loss minus the stationary time above the session's
 * median stationary time (over every stop that served no penalty, all conditions); `stationaryMs` keeps the raw time.
 * A stop that served a penalty is `penalty` (R12, whatever its reference laps), a stop without a loss `noReference`;
 * neither counts for an estimate.
 */
export function sessionStops(pitStops: readonly DeepReadonly<PitStopRecord>[], laps: readonly DeepReadonly<LapRecord>[], opts: PitLossOptions): PitLossStop[] {
  if (pitStops.length === 0) return [];
  const counted = pitStops.filter((s) => !s.penaltyServed);
  const stationaryMedian = median(counted.map((s) => s.stationaryTimeMs));
  const lapsByCar = new Map<CarId, DeepReadonly<LapRecord>[]>();
  for (const lap of laps) {
    const list = lapsByCar.get(lap.carId);
    if (list === undefined) lapsByCar.set(lap.carId, [lap]);
    else list.push(lap);
  }
  return [...pitStops]
    .sort((a, b) => a.lap - b.lap)
    .map((stop): PitLossStop => {
      const base = { carId: stop.carId, lap: stop.lap, condition: stop.flag, stationaryMs: stop.stationaryTimeMs };
      const raw = stopLoss(stop, lapsByCar.get(stop.carId) ?? [], opts);
      if (!raw.known) return { ...base, lossMs: unknown('insufficientData'), use: stop.penaltyServed ? 'penalty' : 'noReference' };
      const aboveMedian = stationaryMedian === undefined ? 0 : Math.max(0, stop.stationaryTimeMs - stationaryMedian);
      return { ...base, lossMs: known(Math.round(raw.value - aboveMedian), raw.at), use: stop.penaltyServed ? 'penalty' : 'used' };
    });
}
