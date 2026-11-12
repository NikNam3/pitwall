// `forecast-score`'s forecast cases (SP4.3a spec 7.1; plan Task 19): per leader lap L and horizon h, per car, what the
// plain forecast from the leader's crossing of lap L is scored against at lap L + h, beside the "gaps stay" baseline.
import { NOISE_COMPOUNDS, type CarId, type FrameNumber, type LapRecord, type Ms, type NoiseCompound, type Policy, type RivalStops, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly, Projection } from '@pitwall/engine/readers';
import { raceLaps } from './laps.ts';

/** The horizons the report has a table for (spec 7.1). */
export type Horizon = 1 | 3 | 5 | 10;

/** Every horizon a report may hold, ascending. */
export const HORIZONS: readonly Horizon[] = [1, 3, 5, 10];

/**
 * One car's forecast case. `lap`: the leader lap L the forecast starts from; `predictFrame`: the frame of the leader's
 * lap-L record (`positionAtEnd` 1), `predictAt` its race-clock time; `targetLap` = L + `horizon`, the car's own lap
 * number. Actual values from the car's confirmed record of `targetLap` (C25): `actualLapTimeMs`, `actualPosition`
 * (`positionAtEnd`). `baselinePosition`: the "gaps stay as they are" forecast, the car's `positionAtEnd` of lap L.
 * `basis`: `wear` when the car's lap-L record has its wear known (`wearAtEndPct`), else `age` (C8: tyre age times the
 * car's wear rate).
 */
export type ForecastCase = {
  lap: number;
  horizon: Horizon;
  carId: CarId;
  basis: 'wear' | 'age';
  predictFrame: FrameNumber;
  predictAt: SessionTime;
  targetLap: number;
  actualLapTimeMs: Ms;
  actualPosition: number;
  baselinePosition: number;
};

/** Whether every corner's wear of the lap's end is known. */
const wearKnown = (l: DeepReadonly<LapRecord>): boolean => {
  const w = l.wearAtEndPct;
  return w.fl.known && w.fr.known && w.rl.known && w.rr.known;
};

/**
 * The forecast cases of `history`: for every leader lap L that has a confirmed record of the leader, every horizon h
 * with lap L + h completed (a confirmed record) by the car. Dry laps only: a case whose laps L to L + h hold a lap on
 * inter or wet tyres, or a weather crossover (a stop from slicks to inter or wet tyres, or back), is no case.
 */
export function forecastCases(history: Projection, horizons: readonly Horizon[]): ForecastCase[] {
  const race = raceLaps(history);
  const leaders: DeepReadonly<LapRecord>[] = [];
  for (let car = 0; car < race.cars; car++) for (const l of race.lapsOf(car)) if (l.positionAtEnd === 1) leaders[l.lapNumber] = l;
  const cases: ForecastCase[] = [];
  for (const leader of leaders) {
    if (leader === undefined) continue;
    const lap = leader.lapNumber;
    for (const horizon of horizons) {
      for (let car = 0; car < race.cars; car++) {
        const start = race.lap(car, lap);
        const target = race.lap(car, lap + horizon);
        if (start === undefined || target === undefined || !race.dry(car, lap, lap + horizon)) continue;
        cases.push({
          lap,
          horizon,
          carId: car as CarId,
          basis: wearKnown(start) ? 'wear' : 'age',
          predictFrame: leader.frame,
          predictAt: leader.completedAt,
          targetLap: lap + horizon,
          actualLapTimeMs: target.lapTimeMs,
          actualPosition: target.positionAtEnd,
          baselinePosition: start.positionAtEnd,
        });
      }
    }
  }
  return cases;
}

/** The likeliest compound of `odds` (the first in `NOISE_COMPOUNDS` order on a tie); none without odds. */
function likeliest(odds: DeepReadonly<Partial<Record<NoiseCompound, number>>>): NoiseCompound | undefined {
  let best: NoiseCompound | undefined;
  for (const c of NOISE_COMPOUNDS) {
    const p = odds[c];
    if (p !== undefined && (best === undefined || p > (odds[best] as number))) best = c;
  }
  return best;
}

/**
 * The policies of a scored forecast (plan review P7): every car of `cars` slots follows `rival-stops`' window as the
 * model would have: one stop on `window.midLap` onto its likeliest next compound; no stop when its window is not known,
 * reaches the flag (`toFlag`), or its next compound's odds are not known.
 */
export function forecastPolicies(stops: DeepReadonly<RivalStops>, cars: number): Policy[] {
  return Array.from({ length: cars }, (_, k): Policy => {
    const stop = stops[k as CarId];
    if (stop === undefined || !stop.window.known || stop.window.value.toFlag || !stop.nextCompound.known) return { stops: [] };
    const compound = likeliest(stop.nextCompound.value);
    return compound === undefined ? { stops: [] } : { stops: [{ lap: stop.window.value.midLap, compound }] };
  });
}
