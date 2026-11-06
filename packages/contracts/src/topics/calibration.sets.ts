// Every calibration set, of all tracks (C54, C62a, spec 5): the bridge's user state, published by its calibration module (C55).
import type { CalibrationSetsValue } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, CalibrationSetsValue>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
