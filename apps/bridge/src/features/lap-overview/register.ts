import { lapOverviewCalculator } from '@pitwall/analysis';
import { bindState, defineFeature, selectCar } from '../feature.ts';

/** `lap-overview` (SP4.1b spec 3): `lapOverview.car`. */
export default defineFeature({
  name: 'lap-overview',
  calculators: [lapOverviewCalculator],
  topics: [bindState('lapOverview.car', lapOverviewCalculator, selectCar)],
});
