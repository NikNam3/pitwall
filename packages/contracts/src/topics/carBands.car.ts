// Every band channel of the car against its band (spec 5.4).
import type { CarBands } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, CarBands>({ owner: 'car-bands', mode: 'state', maxHz: 4, momentParams: eachCar });
