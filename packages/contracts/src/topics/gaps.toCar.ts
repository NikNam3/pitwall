// Every car's signed gap to the params car, positive = behind it (spec 6.1).
import type { GapToCar } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, GapToCar[]>({ owner: 'gaps', mode: 'state', maxHz: 4, momentParams: eachCar });
