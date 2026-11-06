// The pit loss per condition and this session's stops, for the pit-loss table (spec 4.3, 5).
import type { PitLosses } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, PitLosses>({ owner: 'pit-losses', mode: 'state', maxHz: 1 });
