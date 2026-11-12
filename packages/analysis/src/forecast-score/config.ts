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
});
