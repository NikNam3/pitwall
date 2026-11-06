// What `track-positions` does per situation (contract C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the situation; the calculator only looks up the rows of the spans open now and merges them per car.
import { carFlagsSpans, carLocationSpans, carStatusSpans, zoneFlagsSpans, type MapZone } from '@pitwall/domain';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the situations open now say about the map; every field absent means "no change". */
export type TrackPositionsEffect = {
  /**
   * Whether the car is drawn: set by car-status (only a competing car is), so a slot without its span is left out
   * (C17); car-location's `garage` leaves a competing car out too.
   */
  drawn?: boolean;
  /** The car is in the pit lane: drawn hollow. */
  inPit?: true;
  /** The car is shown the blue flag. */
  blueFlag?: true;
  /** A marshal zone's flag on the map. */
  zoneFlag?: MapZone['flag'];
};

const NONE: TrackPositionsEffect = {};

const zoneRows = Object.fromEntries(zoneFlagsSpans.kinds.map((kind) => [kind, { zoneFlag: kind }])) as Record<
  (typeof zoneFlagsSpans)['kinds'][number],
  TrackPositionsEffect
>;

/** The rows of the car-scoped machines: what a car's open spans make of its marker. */
export const TRACK_POSITIONS_CAR_ROWS: BehaviourTable<TrackPositionsEffect> = {
  [carStatusSpans.machine]: { competing: { drawn: true }, retired: { drawn: false }, disqualified: { drawn: false }, absent: { drawn: false } },
  [carLocationSpans.machine]: { garage: { drawn: false }, pitLane: { inPit: true }, track: NONE },
  [carFlagsSpans.machine]: { noFlag: NONE, green: NONE, blue: { blueFlag: true }, yellow: NONE, unknown: NONE },
};

/** The rows of zone-flags: every kind is drawn as its own flag. */
export const TRACK_POSITIONS_ZONE_ROWS: Record<string, TrackPositionsEffect> = zoneRows;

export const TRACK_POSITIONS_BEHAVIOUR: BehaviourTable<TrackPositionsEffect> = {
  ...TRACK_POSITIONS_CAR_ROWS,
  [zoneFlagsSpans.machine]: TRACK_POSITIONS_ZONE_ROWS,
};
