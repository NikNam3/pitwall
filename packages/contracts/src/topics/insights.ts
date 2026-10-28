import type { Insight, SessionTime } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** Structurally the engine's `InsightChange`: an insight is raised, later resolved by its key. */
export type InsightEntry = { type: 'raised'; insight: Insight } | { type: 'resolved'; key: string; at: SessionTime };

export default defineTopic<NoParams, InsightEntry>({ owner: 'core', mode: 'append', maxHz: Infinity });
