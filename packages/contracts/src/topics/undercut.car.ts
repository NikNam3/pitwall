// One of our cars' undercut call (SP4.3b spec §9.1): per rival in range and N = 1–3, the gap change once both have
// stopped; a job's result (C51).
import type { Known, Undercut } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Computed<Known<Undercut>>>({ owner: 'undercut', mode: 'state', maxHz: 1, momentParams: eachCar });
