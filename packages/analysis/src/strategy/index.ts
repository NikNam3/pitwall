// `strategy` (SP4.3b spec §8.1): an analysis with a job (C51) that plans both our cars, one part per car
// (Task 25): the DP's plans and their neighbours and rule candidates, scored by `race-monte-carlo` over common
// scenarios. Topic `strategy.plans`.
import type { StrategyOutput } from '@pitwall/domain';
import type { Cadence, Dependency, Job } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { FORECAST_UNITS } from '../shared/forecast-field/index.ts';
import { mergeStrategy, splitStrategy } from './job.ts';
import { prepareStrategy, type StrategyInput } from './prepare.ts';

export * from './config.ts';
export { STRATEGY_BEHAVIOUR, type StrategyEffect } from './behaviour.ts';
export { candidatesOf, policyOf } from './candidates.ts';
export { prepareStrategy, type StrategyInput } from './prepare.ts';
export { candidatesForRun, followable, mergeStrategy, partFinalCall, run as runStrategy, splitStrategy, type CarPlan, type FinalCall } from './job.ts';

/** The analysis id (its job's id). */
export const STRATEGY = 'strategy';

/** The output: per our car the ranked rows. */
export type { StrategyOutput };

/**
 * When the job runs (spec §8.1): a line crossing of either of our cars (a lap record of theirs), any stop, an SC or VSC
 * start or end (the race's session phase), a plan decision; and on a rewind (C30).
 */
export const STRATEGY_TRIGGER = { onChange: ['ourLap', 'pitStops', 'spans:session-phase-race', 'decisions'] } as const satisfies Cadence;

const OWN_READS: Dependency[] = [
  'laps', 'stints', 'pitStops', 'miniSectors', 'events', 'decisions', 'drivers', 'session', 'identity', 'tyres',
  'spans:session-phase-race', 'spans:car-activity-race', 'spans:car-driver', 'spans:compound-rule', 'spans:weekend-phase', CAR_STATUS_READS,
  { calculator: 'race-hazard' },
];

/** Its own reads and those of `forecast-field`'s estimation units, which run inside `prepare` (C41). */
const READS: Dependency[] = [...OWN_READS];
for (const unit of FORECAST_UNITS) {
  for (const read of unit.reads) {
    // an estimation unit's upstream unit runs inside `prepare` too: no output of it is read from the view
    if (typeof read === 'object' || READS.includes(read)) continue;
    READS.push(read);
  }
}

/** The job (C51): see `STRATEGY_TRIGGER`; on demand of `strategy.plans` (C49). */
export const STRATEGY_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: STRATEGY,
  reads: READS,
  trigger: { onChange: [...STRATEGY_TRIGGER.onChange] },
  prepare: (view) => prepareStrategy(view),
  module: new URL('./job.ts', import.meta.url),
  // one part per our car planned, each with the whole cap (SP4.3b Q4 D, Task 25)
  parts: { split: splitStrategy, merge: mergeStrategy },
};
