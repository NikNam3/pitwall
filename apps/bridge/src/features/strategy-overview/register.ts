import { strategyOverviewCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `strategy-overview` (SP4.3d spec §6.4): `strategyOverview.car`, per our car the field within one pit loss. */
export default defineFeature({
  name: 'strategy-overview',
  calculators: [strategyOverviewCalculator],
  topics: [bindState('strategyOverview.car', strategyOverviewCalculator, (out, params) => selectCar(out.cars, params))],
});
