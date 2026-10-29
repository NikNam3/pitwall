// Per our car, the cars around it (spec 6.1).
import type { Neighbourhood } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Neighbourhood[]>({ owner: 'gaps', mode: 'state', maxHz: 2 });
