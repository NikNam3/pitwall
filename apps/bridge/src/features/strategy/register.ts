import { STRATEGY_CONFIG, STRATEGY_JOB } from '@pitwall/analysis';
import { bindJob, defineFeature } from '../feature.ts';

/**
 * `strategy` (SP4.3b spec §8.1): both our cars' ranked policies, a job (C51) triggered at our cars' line crossings, a
 * stop, the race's session phase and a plan decision, run in a worker only while `strategy.plans` is subscribed (C49);
 * its result is published whole as `Computed<StrategyOutput>` (a car's selection is SP4.3b2's). It also declares the
 * Monte Carlo's settings (C47): `race-monte-carlo` is a simulator without a config of its own (C50).
 */
export default defineFeature({
  name: 'strategy',
  calculators: [],
  topics: [bindJob('strategy.plans', STRATEGY_JOB)],
  jobs: [STRATEGY_JOB],
  config: [STRATEGY_CONFIG],
});
