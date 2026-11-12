// `strategy` (SP4.3b spec §8.1): an analysis with a job (C51) that plans both our cars: the DP's plans and their
// neighbours and rule candidates, scored by `race-monte-carlo` over common scenarios. Topic `strategy.plans`.
import type { StrategyOutput } from '@pitwall/domain';
import type { Job } from '@pitwall/engine/readers';
import { prepareStrategy, type StrategyInput } from './prepare.ts';

export * from './config.ts';
export { prepareStrategy, type StrategyInput } from './prepare.ts';
export { run as runStrategy } from './job.ts';

/** The analysis id (its job's id). */
export const STRATEGY = 'strategy';

/** The output: per our car the ranked rows. */
export type { StrategyOutput };

/** The job (C51): triggered at our cars' line crossings (Task 20 adds the events), on demand of `strategy.plans` (C49). */
export const STRATEGY_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: STRATEGY,
  reads: [
    'laps', 'stints', 'pitStops', 'miniSectors', 'events', 'decisions', 'drivers', 'session', 'identity',
    'spans:session-phase-race', 'spans:car-activity-race', 'spans:car-driver', 'spans:compound-rule', 'spans:weekend-phase',
    { calculator: 'race-hazard' },
  ],
  trigger: 'ourCrossing',
  prepare: (view) => prepareStrategy(view),
  module: new URL('./job.ts', import.meta.url),
};
