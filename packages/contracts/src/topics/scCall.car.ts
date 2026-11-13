// One of our cars' SC call (SP4.3b spec §9.3; from SP4.2 spec 3.3): per condition SC and VSC, boxing under it now
// against staying out; a job's result (C51).
import type { ScCall } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Computed<ScCall>>({ owner: 'sc-call', mode: 'state', maxHz: 1, momentParams: eachCar });
