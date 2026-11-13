import { STRATEGY_CONFIG, STRATEGY_JOB } from '@pitwall/analysis';
import { bindJob, defineFeature, selectCar } from '../feature.ts';

/**
 * `strategy` (SP4.3b spec §8.1, §9): both our cars' ranked policies, a job (C51) triggered at our cars' line crossings,
 * a stop, the race's session phase and a plan decision, run in a worker only while one of its topics is subscribed
 * (C49); its result is published whole as `Computed<StrategyOutput>` (`strategy.plans`) and per car (`strategy.car`).
 * It also declares the Monte Carlo's settings (C47): `race-monte-carlo` is a simulator without a config of its own (C50).
 */
export default defineFeature({
  name: 'strategy',
  calculators: [],
  topics: [bindJob('strategy.plans', STRATEGY_JOB), bindJob('strategy.car', STRATEGY_JOB, selectCar)],
  jobs: [STRATEGY_JOB],
  config: [STRATEGY_CONFIG],
});
