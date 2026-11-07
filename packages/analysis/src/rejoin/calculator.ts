// `rejoin` (SP4.2 spec 3.2): stub until Task 6.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { GAPS } from '../gaps/index.ts';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { REJOIN, type RejoinOutput } from './index.ts';

export const rejoinCalculator: QuickCalculator<RejoinOutput> = {
  id: REJOIN,
  kind: 'quick',
  reads: [{ calculator: GAPS }, { calculator: PIT_LOSS }, 'identity', 'timing', 'spans:weekend-phase', 'spans:car-activity-race', 'spans:car-status'],
  cadence: 'ourCrossing',
  compute: (): RejoinOutput => {
    throw new Error('not implemented');
  },
};
