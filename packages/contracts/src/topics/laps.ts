import type { LapRecord } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, LapRecord>({ mode: 'append', maxHz: Infinity });
