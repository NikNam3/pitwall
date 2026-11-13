// The loss of one stop (spec 4.3, TUM): in-lap + out-lap − 2 × the car's median `forPace` lap of the `referenceLaps`
// laps before the stop; the stationary time above the session's median is removed and kept apart. Shared by the
// calculator (this session's stops) and the priors aggregate (each source session's stops).
import { known, unknown, type CarId, type Known, type LapRecord, type Ms, type PitLossStop, type PitStopRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { classifyLap, type LapClassOptions } from '../lap-classes/index.ts';
import type { PIT_LOSS_CONFIG } from './config.ts';

/** The effective `pit-loss` config (C47). */
export type PitLossConfig = typeof PIT_LOSS_CONFIG.defaults;

/** The `pit-loss` config with the `classifyLap` options of the stops' session (its weekend phase and `lap-classes`' config). */
export type PitLossOptions = PitLossConfig & { classes: LapClassOptions };

/** The median of a non-empty list; the mean of the middle two for an even count. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** A stop's in-lap and out-lap and the car's reference lap: the median of its `forPace` laps among the `referenceLaps` before the in-lap. */
type StopLaps = { inLap: DeepReadonly<LapRecord>; outLap: DeepReadonly<LapRecord>; referenceMs: number };

/** The laps of `stop` among `carLaps` (only the stop's car's are used); without an in-lap, an out-lap or a `forPace` reference lap: none. */
function stopLaps(stop: DeepReadonly<PitStopRecord>, carLaps: readonly DeepReadonly<LapRecord>[], opts: PitLossOptions): StopLaps | undefined {
  const byNumber = new Map<number, DeepReadonly<LapRecord>>();
  for (const lap of carLaps) if (lap.carId === stop.carId) byNumber.set(lap.lapNumber, lap);
  const inLap = byNumber.get(stop.lap);
  const outLap = byNumber.get(stop.lap + 1);
  const references: Ms[] = [];
  for (let n = stop.lap - opts.referenceLaps; n < stop.lap; n++) {
    const lap = byNumber.get(n);
    if (lap !== undefined && classifyLap(lap, opts.classes).forPace) references.push(lap.lapTimeMs);
  }
  if (inLap === undefined || outLap === undefined || references.length === 0) return undefined;
  return { inLap, outLap, referenceMs: median(references) };
}

/**
 * A stop's TUM loss before the stationary correction: in-lap (`lapNumber === stop.lap`) + out-lap (`stop.lap + 1`) − 2 ×
 * the median of the car's `forPace` laps among the `referenceLaps` laps right before the in-lap. `carLaps` are current
 * laps (`currentLaps`, C25); only the stop's car's are used. Without an in-lap, an out-lap or a `forPace` reference lap:
 * `insufficientData`.
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
  const stationaryMedian = counted.length === 0 ? undefined : median(counted.map((s) => s.stationaryTimeMs));
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
