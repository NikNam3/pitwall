// The `rain-outlook` calculator (spec 3.3). Stub: Task 2 implements it.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { RAIN_OUTLOOK, type RainOutlook } from './index.ts';

export const rainOutlookCalculator: QuickCalculator<RainOutlook> = {
  id: RAIN_OUTLOOK,
  kind: 'quick',
  reads: ['session'],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
