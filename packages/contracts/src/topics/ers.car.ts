// ERS store, this lap's deployment and harvest, trend and laps to the attack level (spec 5.3).
import type { ErsState } from '@pitwall/domain';
import { defineTopic, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, ErsState>({ owner: 'ers', mode: 'state', maxHz: 4 });
