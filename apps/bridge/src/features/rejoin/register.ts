import { REJOIN_CONFIG, ghostLinesOf, rejoinCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';
import { referenceParam } from '../gaps/params.ts';

/** `rejoin` (SP4.2 spec 3.2): `rejoin.car` and `rejoin.ghostLines` (in the gap chart's reference). */
export default defineFeature({
  name: 'rejoin',
  calculators: [rejoinCalculator],
  topics: [
    bindState('rejoin.car', rejoinCalculator, (out, params) => selectCar(out.cars, params)),
    bindState('rejoin.ghostLines', rejoinCalculator, (out, params) => {
      const reference = referenceParam(out.ghost.gaps, params);
      return reference === undefined ? undefined : ghostLinesOf(out.ghost, reference);
    }),
  ],
  config: [REJOIN_CONFIG],
});
