// Per car every lap with its stint, heat, bests and track status, for the lap-overview grid (spec 3.2); every car.
import type { LapOverview } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, LapOverview>({ owner: 'lap-overview', mode: 'state', maxHz: 1, momentParams: eachCar });
