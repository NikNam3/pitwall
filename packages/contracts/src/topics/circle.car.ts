// The field as a lap circle with the stop's ghosts, for one of our cars (SP4.3d spec §6.5).
import type { Circle } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Circle>({ owner: 'circle', mode: 'state', maxHz: 10, momentParams: eachCar });
