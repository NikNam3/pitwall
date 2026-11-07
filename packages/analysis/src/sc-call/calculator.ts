// `sc-call` (SP4.2 spec 3.3): stub until Task 7.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { REJOIN } from '../rejoin/index.ts';
import { SC_CALL, type ScCallOutput } from './index.ts';

export const scCallCalculator: QuickCalculator<ScCallOutput> = {
  id: SC_CALL,
  kind: 'quick',
  reads: [{ calculator: REJOIN }, { calculator: PIT_LOSS }, 'spans:weekend-phase'],
  cadence: 'ourCrossing',
  compute: (): ScCallOutput => {
    throw new Error('not implemented');
  },
};
