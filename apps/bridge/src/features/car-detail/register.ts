import { bindLive, defineFeature } from '../feature.ts';
import { selectCarSlot } from '../car-params.ts';

/** One car's slot of the live state, a core topic (C54, C55): no calculator, copied when the hub sends it. */
export default defineFeature({
  name: 'car-detail',
  calculators: [],
  topics: [bindLive('car.detail', selectCarSlot((car) => car))],
});
