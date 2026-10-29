import { sessionRemainingCalculator } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

/** `session-remaining` is a shared calculator without topics; analyses and displays read it through their `reads`. */
export default defineFeature({
  name: 'session-remaining',
  calculators: [sessionRemainingCalculator],
  topics: [],
});
