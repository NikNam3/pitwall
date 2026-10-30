// The car's projected lap, cut-off and finish margin (spec 6.2).
import type { Projection } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Projection>({ owner: 'lap-times', mode: 'state', maxHz: 10, momentParams: eachCar });
