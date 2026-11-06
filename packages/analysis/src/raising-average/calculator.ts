// The `raising-average` analysis (spec 3.1). Stub: Task 3 implements it.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { RAISING_AVERAGE, type RaisingAverageOutput } from './index.ts';

export const raisingAverageCalculator: QuickCalculator<RaisingAverageOutput> = {
  id: RAISING_AVERAGE,
  kind: 'quick',
  reads: ['laps', 'spans:weekend-phase'],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
