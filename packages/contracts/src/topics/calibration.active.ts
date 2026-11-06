// The feed's run: its calibration set and priors snapshot, and whether a pick or the preselection chose it (C54, C62a, spec 3.3, 5).
import type { CalibrationActiveValue } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, CalibrationActiveValue>({ owner: 'core', scope: 'feed', mode: 'state', maxHz: Infinity });
