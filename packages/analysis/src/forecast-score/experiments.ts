// `forecast-score`'s natural experiments (SP4.3a spec 7.1, O12; plan Task 19): pure functions of the projection that
// find the rejoins, undercuts and SC stops worth scoring, and how each is measured. Dry laps only: a case on a lap on
// inter or wet tyres, or around a weather crossover (a stop from slicks to inter or wet tyres, or back), is no case.
import type { CarId, FrameNumber, Known, PitStopRecord, Policy } from '@pitwall/domain';
import type { Projection } from '@pitwall/engine/readers';
import type { FORECAST_SCORE_CONFIG } from './config.ts';

/** The effective config of `forecast-score`. */
export type ForecastScoreConfig = typeof FORECAST_SCORE_CONFIG.defaults;

export type CaseKind = 'rejoin' | 'undercut' | 'scStop';

/**
 * One natural experiment. Gaps and positions are read from the confirmed lap records (`currentLaps`, C25): the gap of
 * two cars at the end of lap k is `completedAt(otherCarId, k) − completedAt(carId, k)`.
 *
 * - `rejoin`: a green stop of `carId` on lap s (its in lap). `predictFrame`: the frame of its lap s − 1 record (the
 *   in-lap crossing). `measure`: its `positionAtEnd` on lap s + 1 (the first crossing after the out lap), in places.
 * - `undercut`: `carId` stops first (lap s1), `otherCarId` second (lap s2, `minLapsApart` ≤ s2 − s1 ≤ `maxLapsApart`),
 *   within `closeGapMs` (absolute) at the end of lap s1 − 1, no neutralisation span between that crossing and the end
 *   of lap s2 + 1. `predictFrame`: `carId`'s lap s1 − 1 record. `measure`: the change of their gap from the end of lap
 *   s1 − 1 to the end of lap s2 + 1 (the second car's out lap), in ms.
 * - `scStop`: a stop of `carId` on lap s whose `flag` is `sc` or `vsc`, against `otherCarId`, a car that made no stop
 *   during that neutralisation and was within ±`scPlaces` of `carId` by `positionAtEnd` of lap s − 1. `predictFrame`:
 *   `carId`'s lap s − 1 record. `measure`: the change of their gap from the end of lap s − 1 to the end of lap n +
 *   `scSettleLaps`, where n is `carId`'s first lap completed after the neutralisation span's end, in ms.
 *
 * `policy` (by car slot, every car of the race; plan review P7): every car, the tested ones included, follows its
 * actual stops not yet made at `predictFrame` (those on lap s or later, s the case's predict lap + 1), each with the
 * compound it left on. So the case isolates the rejoin, undercut or SC stop it tests.
 */
export type Case = {
  kind: CaseKind;
  carId: CarId;
  otherCarId?: CarId;
  predictFrame: FrameNumber;
  policy: Policy[];
  measure: (history: Projection) => number;
};

export type Experiments = { rejoin: Case[]; undercut: Case[]; scStop: Case[] };

/**
 * The natural experiments of `history`. Rejoin: every green stop, but a repair (stationary longer than
 * `repairStationaryMs`) and a penalty stop (`penaltyServed`). Every kind: dry laps only, weather crossovers excluded.
 */
export function naturalExperiments(_history: Projection, _config: ForecastScoreConfig): Experiments {
  throw new Error('not implemented');
}

/**
 * The race order at `stop`'s pit exit, measured from the projection: every car by its newest crossing at or before
 * `pitLaneExit` (lap, then segment, then the earlier crossing first); `insufficientData` when the stopping car has no
 * crossing by then.
 */
export function orderAtPitExit(_history: Projection, _stop: PitStopRecord): Known<CarId[]> {
  throw new Error('not implemented');
}
