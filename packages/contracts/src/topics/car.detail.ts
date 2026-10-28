import type { CarState } from '@pitwall/domain';
import { defineTopic, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, CarState>({ owner: 'core', mode: 'state', maxHz: 30 });
