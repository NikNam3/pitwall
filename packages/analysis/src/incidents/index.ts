// `incidents` (spec 6.4, 6.2): publishes `incidents.feed` and `incidents.markers`.
import type { IncidentEntry, Known, MapIncident } from '@pitwall/domain';

export type { IncidentEntry, IncidentForUs, IncidentKind } from '@pitwall/domain';
export * from './config.ts';
export { INCIDENTS_BEHAVIOUR, type IncidentsBehaviour } from './behaviour.ts';

/** The calculator id. */
export const INCIDENTS = 'incidents';

/**
 * The output: `feed`, the last `feedLength` entries, newest first (`incidents.feed`); `markers`, the major entries of the
 * last `markerLaps` leader laps on the track map (`incidents.markers`), `notApplicable` without a track file or an outline.
 */
export type IncidentsOutput = { feed: IncidentEntry[]; markers: Known<MapIncident[]> };
