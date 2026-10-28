import type { RaceEvent } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, RaceEvent>({ owner: 'core', mode: 'append', maxHz: Infinity });
