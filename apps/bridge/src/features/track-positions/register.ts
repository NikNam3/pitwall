import { trackPositionsCalculator } from '@pitwall/analysis';
import { bindState, defineFeature } from '../feature.ts';

/** `track-positions`: the track map's geometry and cars (`trackPositions.geometry`, `trackPositions.cars`), one output for both. */
export default defineFeature({
  name: 'track-positions',
  calculators: [trackPositionsCalculator],
  topics: [
    bindState('trackPositions.geometry', trackPositionsCalculator, (out) => out.geometry),
    bindState('trackPositions.cars', trackPositionsCalculator, (out) => out.cars),
  ],
});
