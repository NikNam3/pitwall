// One of our cars as if it were in the pit lane now, per condition: rejoin position, crossing order, map point (SP4.2 spec 3.2).
import type { Rejoin } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Rejoin>({ owner: 'rejoin', mode: 'state', maxHz: 4, momentParams: eachCar });
