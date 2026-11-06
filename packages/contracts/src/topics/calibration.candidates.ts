// Per track the suggested calibration sources, ordered (C54, C62a, spec 3.2, 5).
import type { CalibrationCandidatesValue } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, CalibrationCandidatesValue>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
