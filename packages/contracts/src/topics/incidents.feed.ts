// The last `feedLength` incidents to our cars or their neighbourhood, newest first (spec 6.4).
import type { IncidentEntry } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, IncidentEntry[]>({ owner: 'incidents', mode: 'state', maxHz: 4 });
