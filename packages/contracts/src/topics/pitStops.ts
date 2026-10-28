import type { PitStopRecord } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, PitStopRecord>({ mode: 'append', maxHz: Infinity });
