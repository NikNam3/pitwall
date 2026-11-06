// The `lap-overview` analysis (spec 3.2). Stub: Task 4 implements it.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { LAP_OVERVIEW, type LapOverviewOutput } from './index.ts';

export const lapOverviewCalculator: QuickCalculator<LapOverviewOutput> = {
  id: LAP_OVERVIEW,
  kind: 'quick',
  reads: ['laps', 'stints', 'spans:weekend-phase', 'spans:session-phase-race', 'spans:session-phase-qualifying', 'spans:session-phase-practice'],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
