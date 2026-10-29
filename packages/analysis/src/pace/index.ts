// `pace` (spec 4): a shared calculator without topics, reading `lap-classes`; others read it through `{ calculator: PACE }`.
import type { CarId, Known, Ms } from '@pitwall/domain';

export * from './config.ts';

/** The calculator id. */
export const PACE = 'pace';

/** The output, per car: the mean of the last `window` pace laps and of the current stint's pace laps. No fuel correction. */
export type Pace = { byCar: Record<CarId, { recentMs: Known<Ms>; stintMs: Known<Ms>; samples: number }> };
