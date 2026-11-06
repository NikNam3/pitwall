// `stint-analysis` (spec 5): a stub until its unit task implements it; not registered by any feature yet.
import type { QuickCalculator } from '@pitwall/engine/readers';
import { STINT_ANALYSIS, type StintAnalysisOutput } from './index.ts';

export const stintAnalysisCalculator: QuickCalculator<StintAnalysisOutput> = {
  id: STINT_ANALYSIS,
  kind: 'quick',
  reads: [{ calculator: 'degradation' }, 'session'],
  cadence: 'frame',
  compute: () => {
    throw new Error('not implemented');
  },
};
