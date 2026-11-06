// Defaults of `degradation` (spec 4.1, 7).
import { defineConfig } from '@pitwall/engine/readers';

export const DEGRADATION_CONFIG = defineConfig('degradation', {
  /** Lap time per kg of fuel, in ms: the fuel correction `lapTimeMs − γ · fuelKg`. Source: Bonomi et al. 2023. */
  gammaMsPerKg: 30,
  /** Fuel burn per lap in kg when our car's rate is unknown. Source: the track-file generator's assumption (SP4.0). */
  fallbackBurnKgPerLap: 1.8,
  /** A lap slower than the prediction by more than this many sd is down-weighted. Source: Cappello & Hoegh. */
  outlierSd: 2.5,
  /** A down-weighted lap's observation noise is multiplied by this. Source: pitwall estimate. */
  outlierNoiseFactor: 10,
  /** `ν` in ms per lap a stint starts from without a prior. Source: pitwall estimate. */
  defaultNuMsPerLap: 60,
  /** The sd of that default `ν`, in ms per lap. Source: pitwall estimate. */
  defaultNuSdMs: 60,
  /** A stint with fewer `forPace` laps is no calibration candidate (`candidate`). Source: pitwall estimate. */
  minSourceLaps: 5,
});
