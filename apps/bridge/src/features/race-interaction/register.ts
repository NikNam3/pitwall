import { RACE_INTERACTION_CONFIG, RACE_INTERACTION_PRIORS, raceInteractionCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `race-interaction`: the pass curve per AI-difficulty band, DRS, the following gap and the O14 values (SP4.3a spec 5.4),
 * a calculator the forecast reads; no topic of its own. Its priors entries (`raceInteraction.passLevel.b<i>`,
 * `raceInteraction.passSlope.b<i>`) run in the bridge's priors store (C62a).
 */
export default defineFeature({
  name: 'race-interaction',
  calculators: [raceInteractionCalculator],
  topics: [],
  config: [RACE_INTERACTION_CONFIG],
  priors: [RACE_INTERACTION_PRIORS],
});
