// Defaults of `forecast-score` (SP4.3a spec 7.1, 8).
import { defineConfig } from '@pitwall/engine/readers';

export const FORECAST_SCORE_CONFIG = defineConfig('forecast-score', {
  /** The forecast horizons in laps, comma-separated. Source: spec 7.1. */
  horizons: '1,3,5,10',
  /** Undercut and overcut: the two cars within this gap at the first stopper's in-lap crossing (ms). Source: research 12 §8. */
  closeGapMs: 3000,
  /** Undercut and overcut: the fewest laps between the two stops. Source: research 12 §8. */
  minLapsApart: 1,
  /** Undercut and overcut: the most laps between the two stops. Source: research 12 §8. */
  maxLapsApart: 5,
  /** SC stop: the cars within this many places that stayed out. Source: research 12 §8. */
  scPlaces: 3,
  /** Rejoin: a stop stationary longer than this is a repair, left out (ms). Source: research 12 §8. */
  repairStationaryMs: 6000,
  /** SC stop: the laps after the neutralisation ends at which the change is measured. Source: research 12 §8. */
  scSettleLaps: 2,
  /** Forecast tables: the first leader lap a forecast case starts from. Source: U9 Q1 A, 2026-11-12 (no fitted pace
   *  before two pace laps; the standing start). */
  minPredictLap: 3,
  /** CRPS: the scenarios of each predict lap's one `fieldPositions` run. Source: SP4.3b spec §8.4 (200 scenarios). */
  crpsScenarios: 200,
  /** CRPS: the first leader lap a predict lap is. Source: SP4.3b spec §8.4; SP4.3b1 plan Task 22 ("from lap 2"). */
  crpsFirstLap: 2,
  /** CRPS: a predict lap every this many leader laps from `crpsFirstLap`. Source: SP4.3b spec §8.4 (every 5 laps, within the 1.5 s job budget, §11). */
  crpsEveryLaps: 5,
});
