import { GAPS_CONFIG, gapperLines, gapsCalculator, gapsToCar } from '@pitwall/analysis';
import { carIdParam, referenceParam } from './params.ts';
import { bindState, defineFeature } from '../feature.ts';

/** `gaps`: every gap from the mini-sector crossings (`gaps.intervals`, `gaps.toCar`, `gaps.gapper`, `gaps.neighbourhood`). */
export default defineFeature({
  name: 'gaps',
  calculators: [gapsCalculator],
  topics: [
    bindState('gaps.intervals', gapsCalculator, (out) => out.intervals),
    bindState('gaps.toCar', gapsCalculator, (out, params) => {
      const carId = carIdParam(out, params);
      return carId === undefined ? undefined : gapsToCar(out, carId);
    }),
    bindState('gaps.gapper', gapsCalculator, (out, params) => {
      const reference = referenceParam(out, params);
      return reference === undefined ? undefined : gapperLines(out, reference);
    }),
    bindState('gaps.neighbourhood', gapsCalculator, (out) => out.neighbourhood),
  ],
  config: [GAPS_CONFIG],
});
