// The field's lap times per tyre type against one of our cars, for the crossover chart (spec 3.4); our cars only, race only.
import type { Crossover } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, Crossover>({ owner: 'crossover', mode: 'state', maxHz: 1, momentParams: eachCar });
