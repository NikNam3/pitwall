import type { CarState } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, CarState>({ owner: 'core', mode: 'state', maxHz: 30, momentParams: eachCar });
