// `pit-losses` (spec 5): a stub until its unit task implements it; not registered by any feature yet.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { PIT_LOSSES, type PitLossesOutput } from './index.ts';

export const pitLossesCalculator: QuickCalculator<PitLossesOutput> = {
  id: PIT_LOSSES,
  kind: 'quick',
  reads: [{ calculator: 'pit-loss' }],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
