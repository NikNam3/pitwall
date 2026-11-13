import { UNDERCUT_CONFIG, UNDERCUT_JOB } from '@pitwall/analysis';
import { bindJob, defineFeature, selectCar } from '../feature.ts';

/**
 * `undercut` (SP4.3b spec §9.1): per our car the undercut cases against the rivals in range, a job (C51) on `strategy`'s
 * trigger, run in a worker only while `undercut.car` is subscribed (C49); the topic selects the car's entry.
 */
export default defineFeature({
  name: 'undercut',
  calculators: [],
  topics: [bindJob('undercut.car', UNDERCUT_JOB, selectCar)],
  jobs: [UNDERCUT_JOB],
  config: [UNDERCUT_CONFIG],
});
