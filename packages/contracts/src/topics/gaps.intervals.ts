// Per car, the gaps to the leader, the car ahead and the car behind, and laps down (spec 6.1).
import type { Interval } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Interval[]>({ owner: 'gaps', mode: 'state', maxHz: 4 });
