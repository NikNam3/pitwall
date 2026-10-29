// `incidents` (spec 6.4): publishes `incidents.feed`.
import type { IncidentEntry } from '@pitwall/domain';

export type { IncidentEntry, IncidentForUs, IncidentKind } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const INCIDENTS = 'incidents';

/** The output: the topic's value, the last `feedLength` entries, newest first. */
export type IncidentsOutput = IncidentEntry[];
