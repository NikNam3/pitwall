import { paceCalculator, PACE_CONFIG } from '@pitwall/analysis';
import { defineFeature } from '../feature.ts';

export default defineFeature({ name: 'pace', calculators: [paceCalculator], topics: [], config: [PACE_CONFIG] });
