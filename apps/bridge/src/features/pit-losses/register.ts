import { pitLossesCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/**
 * `pit-losses`: the pit loss per condition and this session's stops (`pitLosses.track`, spec 5), `pit-loss`'s output as
 * it is. `pit-loss` itself is registered by its own feature.
 */
export default defineFeature({
  name: 'pit-losses',
  calculators: [pitLossesCalculator],
  topics: [bindState('pitLosses.track', pitLossesCalculator)],
});
