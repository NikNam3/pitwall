// What a stop under an SC or VSC would gain against a green stop, for one of our cars (SP4.2 spec 3.3).
import type { ScCall } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, ScCall>({ owner: 'sc-call', mode: 'state', maxHz: 4, momentParams: eachCar });
