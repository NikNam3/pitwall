// Defaults of `track-wetness` (SP4.3a spec 5.1, 8).
import { defineConfig } from '@pitwall/engine/readers';

export const TRACK_WETNESS_CONFIG = defineConfig('track-wetness', {
  /** The filter's process noise per lap: how far the wetness may move from one lap to the next (ms). Source: pitwall estimate (research 12 §3). */
  processNoiseMs: 400,
  /** The filter's measurement noise of one lap's common mode (ms). Source: pitwall estimate (research 12 §3). */
  measurementNoiseMs: 600,
  /** The dry laps a car's reference rests on. Source: pitwall estimate (research 12 §3). */
  dryReferenceLaps: 5,
});
