// `stint-analysis` (spec 5): publishes `stintAnalysis.car`, our cars' stints with their laps and fit from `degradation`.
import type { CarId, StintAnalysis } from '@pitwall/domain';

export type { StintAnalysis } from '@pitwall/domain';

/** The analysis id. */
export const STINT_ANALYSIS = 'stint-analysis';

/** The output: the topic's value per car (rivals `notApplicable`); the binding's `select` picks `params.carId`. */
export type StintAnalysisOutput = Record<CarId, StintAnalysis>;
