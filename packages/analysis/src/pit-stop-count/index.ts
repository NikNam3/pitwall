// `pit-stop-count` (M7-R, final review F2): each car's pit stops, counted from the projection's pit-stop records, for
// every car car-status has had in the session; published as `pitStopCount.byCar` (C42, C53).
import type { CarId } from '@pitwall/domain';

export * from './behaviour.ts';

/** The analysis id. */
export const PIT_STOP_COUNT = 'pit-stop-count';

/**
 * The output: per car car-status has had in the session (any span other than `absent`, open or closed), ordered by car
 * id, the number of its pit-stop records in the projection. Structurally the contracts package's `PitStopCounts` (C55).
 */
export type PitStopCounts = { byCar: ReadonlyArray<{ carId: CarId; stops: number }> };
