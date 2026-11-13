// Defaults of `degradation` (spec 4.1, 7).
import { defineConfig } from '@pitwall/engine/readers';

export const DEGRADATION_CONFIG = defineConfig('degradation', {
  /** Lap time per kg of fuel, in ms: the fuel correction `lapTimeMs − γ · fuelKg`. Source: Bonomi et al. 2023. */
  gammaMsPerKg: 30,
  /** Fuel burn per lap in kg when our car's rate is unknown. Source: the track-file generator's assumption (SP4.0). */
  fallbackBurnKgPerLap: 1.8,
  /** A lap slower than the prediction by more than this many sd is down-weighted. Source: Cappello & Hoegh. */
  outlierSd: 2.5,
  /** A down-weighted lap's observation noise (its variance) is multiplied by this. Source: pitwall estimate. */
  outlierNoiseFactor: 10,
  /** The sd of a pace lap's corrected time around the model `α + ν · age`, in ms. Source: pitwall estimate. */
  obsSdMs: 400,
  /** Process noise: the sd of the drift of `α` per lap of tyre age (track evolution), in ms. Source: pitwall estimate. */
  processAlphaSdMs: 20,
  /** Process noise: the sd of the drift of `ν` per lap of tyre age, in ms per lap. Source: pitwall estimate. */
  processNuSdMs: 2,
  /** `ν` in ms per lap a stint starts from without a prior. Source: spike 4.3b-defaults (research 19 §5): soft ~190–205, medium ~120 ms/lap at Spa and Texas (53 stints); 60 shrank ν to 0.67× the stints' own slope; thin: two tracks, no hard. */
  defaultNuMsPerLap: 150,
  /** The sd of that default `ν`, in ms per lap. Source: spike 4.3b-defaults (research 19 §5): with mean 150 the stop-gain gap −450 → −215 ± 136 ms (38 stops), free air −446 → −66 ± 125 (12); later-lap bias at k 6–8 589 → 237 ms. */
  defaultNuSdMs: 100,
  /** A stint with fewer `forPace` laps is no calibration candidate (`candidate`). Source: pitwall estimate. */
  minSourceLaps: 5,
});
