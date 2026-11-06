// `pit-loss` (spec 4.3): a stub until its unit task implements it; not registered by any feature yet.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { PIT_LOSS, type PitLossOutput } from './index.ts';

export const pitLossCalculator: QuickCalculator<PitLossOutput> = {
  id: PIT_LOSS,
  kind: 'quick',
  reads: ['pitStops', 'laps', 'decisions'],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
