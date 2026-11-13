// Defaults of `race-hazard` (SP4.3b spec §5.2, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const RACE_HAZARD_CONFIG = defineConfig('race-hazard', {
  /** The lobby's "Reduced" SC setting multiplies every start chance by this. Source: pitwall estimate (spec §5.2). */
  reducedFactor: 0.5,
  /** The lobby's "Increased" SC setting multiplies every start chance by this. Source: pitwall estimate (spec §5.2). */
  increasedFactor: 1.5,
});
