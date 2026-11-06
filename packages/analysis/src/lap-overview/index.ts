// `lap-overview` (spec 3.2): publishes `lapOverview.car`, every lap of every car with its heat, bests and status.
import type { CarId, LapOverview } from '@pitwall/domain';

export type { LapOverview, LapOverviewLap, LapStatus } from '@pitwall/domain';

/** The analysis id. */
export const LAP_OVERVIEW = 'lap-overview';

/** The output: the topic's value per car; the binding's `select` picks `params.carId`. */
export type LapOverviewOutput = Record<CarId, LapOverview>;
