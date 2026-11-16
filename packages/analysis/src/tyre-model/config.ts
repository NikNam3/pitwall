// Defaults of `tyre-model` (SP4.3c spec §5.2): what the tyre types share (the limit, the drivers' wear factors, the
// measured-rate rule, the loss threshold, the rate without the game's sets). Each tyre type's own terms are in its
// module's config (`types/*.config.ts`). The carcass reference temperatures are `car-bands`' (ruling R20, C43).
import { defineConfig } from '@pitwall/engine/readers';

export const TYRE_MODEL_CONFIG = defineConfig('tyre-model', {
  /** The wear limit no stint is planned or predicted past, in %. Source: the user's hard rule (spec §5.2); the game's own life runs to 70 % (research 22 §1.1). */
  limitPct: 70,
  /** The AI's wear factor k against the game's rate 70 / usableLife. Source: research 22 §1.2 (260 AI stints, IQR 0.80–0.95). */
  aiWearFactor: 0.86,
  /** A human's wear factor k without a profile entry. Source: research 22 §1.2 (our drivers 1.2–1.4, 12 stints). */
  humanWearFactor: 1.3,
  /** A measured rate needs at least this many rate laps on the set. Source: research 21 §2 (cumulative rate from 3 laps). */
  minGainLaps: 3,
  /** A measured rate needs at least this much wear accrued over its laps at the corner, in %. Source: research 21 §2. */
  minAccruedPct: 5,
  /** The measured rate is the cumulative gain over the newest this many rate laps. Source: research 21 §2. */
  rateWindowLaps: 5,
  /** Below this wear of the fitted set the game's delta is noise: the loss per % is the default, in %. Source: research 22 §1.6. */
  minWearForLossPct: 8,
  /** The wear rate of a compound without the game's sets (no usable life known), in % per lap. Source: research 22 §1.2's flat baseline (2.0 %/lap), the rate before the game prior. */
  defaultRatePct: 2,
});
