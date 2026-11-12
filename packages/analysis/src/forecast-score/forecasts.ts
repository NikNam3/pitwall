// `forecast-score`'s forecast cases (SP4.3a spec 7.1; plan Task 19): per leader lap L and horizon h, per car, what the
// plain forecast from the leader's crossing of lap L is scored against at lap L + h, beside the "gaps stay" baseline.
import type { CarId, FrameNumber, Ms, Policy, RivalStops } from '@pitwall/domain';
import type { Projection } from '@pitwall/engine/readers';

/** The horizons the report has a table for (spec 7.1). */
export type Horizon = 1 | 3 | 5 | 10;

/**
 * One car's forecast case. `lap`: the leader lap L the forecast starts from; `predictFrame`: the frame of the leader's
 * lap-L record (`positionAtEnd` 1); `targetLap` = L + `horizon`, the car's own lap number. Actual values from the car's
 * confirmed record of `targetLap` (C25): `actualLapTimeMs`, `actualPosition` (`positionAtEnd`). `baselinePosition`:
 * the "gaps stay as they are" forecast, the car's `positionAtEnd` of lap L. `basis`: `wear` when the car's lap-L record
 * has its wear known (`wearAtEndPct`), else `age` (C8: tyre age times the car's wear rate).
 */
export type ForecastCase = {
  lap: number;
  horizon: Horizon;
  carId: CarId;
  basis: 'wear' | 'age';
  predictFrame: FrameNumber;
  targetLap: number;
  actualLapTimeMs: Ms;
  actualPosition: number;
  baselinePosition: number;
};

/**
 * The forecast cases of `history`: for every leader lap L that has a confirmed record of the leader, every horizon h
 * with lap L + h completed (a confirmed record) by the car. Dry laps only: a case whose laps L to L + h hold a lap on
 * inter or wet tyres, or a weather crossover (a stop from slicks to inter or wet tyres, or back), is no case.
 */
export function forecastCases(_history: Projection, _horizons: readonly Horizon[]): ForecastCase[] {
  throw new Error('not implemented');
}

/**
 * The policies of a scored forecast (plan review P7): every car of `cars` slots follows `rival-stops`' window as the
 * model would have: one stop on `window.midLap` onto its likeliest next compound; no stop when its window is not known,
 * reaches the flag (`toFlag`), or its next compound's odds are not known.
 */
export function forecastPolicies(_stops: RivalStops, _cars: number): Policy[] {
  throw new Error('not implemented');
}
