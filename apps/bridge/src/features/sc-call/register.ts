import { SC_CALL_CONFIG, SC_CALL_JOB } from '@pitwall/analysis';
import { bindJob, defineFeature, selectCar } from '../feature.ts';

/**
 * `sc-call` (SP4.3b spec §9.3): per our car boxing under an SC or VSC now against staying out, a job (C51) on
 * `strategy`'s trigger, run in a worker only while `scCall.car` is subscribed (C49); the topic selects the car's entry.
 */
export default defineFeature({
  name: 'sc-call',
  calculators: [],
  topics: [bindJob('scCall.car', SC_CALL_JOB, selectCar)],
  jobs: [SC_CALL_JOB],
  config: [SC_CALL_CONFIG],
});
