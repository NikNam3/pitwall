// `rain-outlook` (spec 3.3): the one judgement of "rain is coming" (C43), read by `weather` and `race-moment`. A calculator: no topic.
import type { Known, Percent } from '@pitwall/domain';

export * from './config.ts';

/** The calculator id. */
export const RAIN_OUTLOOK = 'rain-outlook';

/** The first forecast sample at or above `rainPct` (index into the time-ordered samples), and whether it is within `horizonMin`. */
export type RainOutlook = { firstRain: Known<{ index: number; offsetMin: number; rainPct: Percent }>; withinHorizon: boolean };
