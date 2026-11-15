import { rejoinGhostCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `rejoin-ghost` (SP4.3c §5.7, O18): `rejoinGhost.car`, the track map's per-frame ghost. */
export default defineFeature({
  name: 'rejoin-ghost',
  calculators: [rejoinGhostCalculator],
  topics: [bindState('rejoinGhost.car', rejoinGhostCalculator, (out, params) => selectCar(out.cars, params))],
});
