// Defaults of `track-wetness` (SP4.3a spec 5.1, 8).
import { defineConfig } from '@pitwall/engine/readers';

export const TRACK_WETNESS_CONFIG = defineConfig('track-wetness', {
  /** The filter's process noise per lap: how far the wetness may move from one lap to the next (ms). Source: pitwall estimate (research 12 §3). */
  processNoiseMs: 400,
  /** The filter's measurement noise of one lap's common mode (ms). Source: pitwall estimate (research 12 §3). */
  measurementNoiseMs: 600,
  /** The dry laps a car's reference rests on: its stint's first free-air pace laps. Source: pitwall estimate (research 12 §3). */
  dryReferenceLaps: 5,
  /** The sd of the filter's start, a dry track (ms). Source: pitwall estimate (research 12 §3). */
  initialSdMs: 1_000,
  /**
   * How much a forecast rain chance widens the prediction step: its variance × `1 + factor · rainPct / 100`. Source:
   * pitwall estimate (research 12 §3: the same rain % gives different lap times, so rain only adds uncertainty).
   */
  forecastRainNoiseFactor: 1,
  /**
   * A lap is wet once the filtered state after it is more than this many sd above a dry track: a stint with wet laps is
   * refitted on its dry ones. Source: pitwall estimate.
   */
  wetSigmas: 2,
});
