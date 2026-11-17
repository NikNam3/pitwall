// `strategy` (SP4.3b spec §8.1): an analysis with a job (C51) that plans both our cars, one part per car
// (Task 25): the DP's plans and their neighbours and rule candidates, scored by `race-monte-carlo` over common
// scenarios. Topic `strategy.plans`.
import { unknown, type StrategyOutput } from '@pitwall/domain';
import type { Cadence, Job } from '@pitwall/engine/readers';
import { STRATEGY_INPUT_READS } from '../shared/strategy-input/index.ts';
import { mergeStrategy, splitStrategy } from './job.ts';
import { prepareStrategy, type StrategyInput } from './prepare.ts';

export * from './config.ts';
export { STRATEGY_BEHAVIOUR, type StrategyEffect } from './behaviour.ts';
export { candidatesOf, policyOf } from './candidates.ts';
export { prefillOf } from './prefill.ts';
export { prepareStrategy, type StrategyInput } from './prepare.ts';
export { candidatesForRun, mergeStrategy, partFinalCall, run as runStrategy, splitStrategy, type CarPlan, type FinalCall } from './job.ts';

/** The analysis id (its job's id). */
export const STRATEGY = 'strategy';

/** The output: per our car the ranked rows. */
export type { StrategyOutput };

/**
 * When the job runs (spec §8.1): a line crossing of either of our cars (a lap record of theirs), any stop, an SC or VSC
 * start or end (the race's session phase), a plan decision; and on a rewind (C30).
 */
export const STRATEGY_TRIGGER = { onChange: ['ourLap', 'pitStops', 'spans:session-phase-race', 'decisions'] } as const satisfies Cadence;

/** The job's module (runs in a worker) and its parts: one per our car planned, each with the whole cap (SP4.3b Q4 D, Task 25). */
const STRATEGY_MODULE = new URL('./job.ts', import.meta.url);
const STRATEGY_PARTS = { split: splitStrategy, merge: mergeStrategy };

/** The job (C51): see `STRATEGY_TRIGGER`; on demand of `strategy.plans` (C49); it reads what the shared strategy input reads (C41). */
export const STRATEGY_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: STRATEGY,
  reads: [...STRATEGY_INPUT_READS],
  trigger: { onChange: [...STRATEGY_TRIGGER.onChange] },
  prepare: (view) => prepareStrategy(view),
  module: STRATEGY_MODULE,
  parts: STRATEGY_PARTS,
};

/** The planning job's id (SP4.3d2 Task 9). */
export const PLANNING = 'planning';

/**
 * The planning job (C51, C62d; SP4.3d spec §7.1 step 4): the strategy job's module and parts on the ended qualifying
 * session's as-of view. Declared in no feature: the bridge's planning module builds its input with
 * `planningInputFrom` and runs it in the job runner on a planning uiAction, never the scheduler; so it reads nothing
 * and its `prepare` from a live view gives no starting point (`notApplicable`, C3).
 */
export const PLANNING_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: PLANNING,
  reads: [],
  // never scheduled (no feature declares it); a cadence the registry accepts: the round follows a session's end
  trigger: 'sessionChange',
  prepare: () => ({ start: unknown('notApplicable'), hazard: unknown('notApplicable'), ourCars: [], planned: [], committed: {}, positions: {}, config: {} }),
  module: STRATEGY_MODULE,
  parts: STRATEGY_PARTS,
};
