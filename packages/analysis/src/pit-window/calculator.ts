// `pit-window` (SP4.2 spec 3.4): stub until Task 5.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { TYRE_LIFE } from '../tyre-life/index.ts';
import { PIT_WINDOW, type PitWindowOutput } from './index.ts';

export const pitWindowCalculator: QuickCalculator<PitWindowOutput> = {
  id: PIT_WINDOW,
  kind: 'quick',
  reads: [{ calculator: TYRE_LIFE }, 'tyres', 'session', 'laps', 'pitStops', 'decisions', 'timing', 'spans:weekend-phase', 'spans:compound-rule', 'spans:car-activity-race'],
  cadence: { hz: 4 },
  compute: (): PitWindowOutput => {
    throw new Error('not implemented');
  },
};
