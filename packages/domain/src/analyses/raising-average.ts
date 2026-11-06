// Value type of the `raising-average` analysis (spec 3.1, V08): per car the mean of its best X laps, X = 1…n.
import type { CarId } from '../ids.ts';
import type { Ms } from '../units.ts';

/** One car's curve: `pointsMs[X − 1]` = round(mean of its X fastest `forPace` laps), X = 1…laps; `[]` without a `forPace` lap. */
export type RaisingAverageCurve = { carId: CarId; laps: number; pointsMs: Ms[] };

/** `raisingAverage.field`: every car with a lap record, by car id. */
export type RaisingAverage = { cars: RaisingAverageCurve[] };
