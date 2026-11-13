import { PIT_SWEEP_CONFIG, PIT_SWEEP_JOB } from '@pitwall/analysis';
import { bindJob, defineFeature } from '../feature.ts';
import { selectSweep } from './select.ts';

/**
 * `pit-sweep` (SP4.3b spec §9.2): per our car one sweep per compound with a new set, a job (C51) on `strategy`'s trigger,
 * run in a worker only while `pitSweep.car` is subscribed (C49); the topic's select picks the panel's compound.
 */
export default defineFeature({
  name: 'pit-sweep',
  calculators: [],
  topics: [bindJob('pitSweep.car', PIT_SWEEP_JOB, selectSweep)],
  jobs: [PIT_SWEEP_JOB],
  config: [PIT_SWEEP_CONFIG],
});
