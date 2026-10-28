import type { StintRecord } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, StintRecord>({ owner: 'core', mode: 'append', maxHz: Infinity });
