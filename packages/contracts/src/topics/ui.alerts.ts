import type { InsightCategory } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** The alert occurrences the engineer has acknowledged (`ackToken`) and the alert groups they muted (spec 7.7). */
export type AlertsState = { acknowledged: string[]; muted: InsightCategory[] };

export default defineTopic<NoParams, AlertsState>({ owner: 'core', scope: 'global', mode: 'state', maxHz: Infinity });
