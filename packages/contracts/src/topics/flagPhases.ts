import type { FlagPhase } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, FlagPhase>({ owner: 'core', mode: 'append', maxHz: Infinity });
