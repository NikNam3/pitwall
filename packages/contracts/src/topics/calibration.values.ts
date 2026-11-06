// Per calibration set its priors entries and per source its own values, date and residual, or why it is skipped (C54, C62a, spec 5).
import type { CalibrationValuesValue } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, CalibrationValuesValue>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
