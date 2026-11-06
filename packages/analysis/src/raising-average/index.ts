// `raising-average` (spec 3.1): publishes `raisingAverage.field`, per car the mean of its best X `forPace` laps.
import type { RaisingAverage } from '@pitwall/domain';

export type { RaisingAverage, RaisingAverageCurve } from '@pitwall/domain';

/** The analysis id. */
export const RAISING_AVERAGE = 'raising-average';

/** The output: the topic's value. */
export type RaisingAverageOutput = RaisingAverage;
