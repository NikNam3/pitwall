import { PIT_LOSS_CONFIG, PIT_LOSS_PRIORS, pitLossCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/**
 * `pit-loss`: the time a stop costs per condition (spec 4.3), a calculator that `pit-losses` reads; no topic of its own.
 * Its priors entries (`pitLoss.ms.<condition>`) run in the bridge's priors store (C62a).
 */
export default defineFeature({
  name: 'pit-loss',
  calculators: [pitLossCalculator],
  topics: [],
  config: [PIT_LOSS_CONFIG],
  priors: [PIT_LOSS_PRIORS],
});
