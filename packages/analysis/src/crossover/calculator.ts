// The `crossover` analysis (spec 3.4). Stub: Task 5 implements it.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { CROSSOVER, type CrossoverOutput } from './index.ts';

export const crossoverCalculator: QuickCalculator<CrossoverOutput> = {
  id: CROSSOVER,
  kind: 'quick',
  reads: ['laps', 'identity', { calculator: PIT_LOSS }, 'spans:weekend-phase', 'spans:session-phase-race'],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
