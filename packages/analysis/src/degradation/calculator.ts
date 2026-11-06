// `degradation` (spec 4.1): a stub until its unit task implements it; not registered by any feature yet.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { DEGRADATION, type DegradationOutput } from './index.ts';

export const degradationCalculator: QuickCalculator<DegradationOutput> = {
  id: DEGRADATION,
  kind: 'quick',
  reads: ['laps', 'stints', 'pitStops', 'tyres', 'decisions', CAR_STATUS_READS],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
