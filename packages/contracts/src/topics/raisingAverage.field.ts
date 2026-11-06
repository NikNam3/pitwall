// Per car the mean of its best X laps for X = 1…n, for the raising-average chart (spec 3.1); every car.
import type { RaisingAverage } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, RaisingAverage>({ owner: 'raising-average', mode: 'state', maxHz: 1 });
