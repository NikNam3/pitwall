import { RACE_MOMENT_CONFIG, raceMomentCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `race-moment`: the moment the race is in (`raceMoment.current`). */
export default defineFeature({
  name: 'race-moment',
  calculators: [raceMomentCalculator],
  topics: [bindState('raceMoment.current', raceMomentCalculator)],
  config: [RACE_MOMENT_CONFIG],
});
