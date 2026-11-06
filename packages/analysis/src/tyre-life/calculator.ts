// `tyre-life` (spec 4.2): a stub until its unit task implements it; not registered by any feature yet.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { TYRE_LIFE, type TyreLifeOutput } from './index.ts';

export const tyreLifeCalculator: QuickCalculator<TyreLifeOutput> = {
  id: TYRE_LIFE,
  kind: 'quick',
  reads: ['laps', 'stints', 'tyres', 'decisions', CAR_STATUS_READS, { calculator: 'degradation' }],
  cadence: { hz: 4 },
  compute: () => {
    throw new Error('not implemented');
  },
};
