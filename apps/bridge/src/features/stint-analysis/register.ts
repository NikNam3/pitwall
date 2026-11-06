import { stintAnalysisCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `stint-analysis` (spec 5): our cars' stints, laps and degradation fit for the stint scatter (`stintAnalysis.car`). */
export default defineFeature({
  name: 'stint-analysis',
  calculators: [stintAnalysisCalculator],
  topics: [bindState('stintAnalysis.car', stintAnalysisCalculator, selectCar)],
});
