// Value types of the `sc-call` analysis (SP4.2 spec 3.3): what a stop under an SC or VSC would gain against a green stop.
import type { EstimateSource } from '../estimates.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/** One condition's row: our rejoin position, the stop's loss and the gain against a green stop (positive = good). */
export type ScCallRow = { condition: 'sc' | 'vsc'; rejoinPosition: Known<number>; lossMs: Known<Ms>; lossSource: EstimateSource; gainMs: Known<Ms> };

/** `scCall.car`: the SC row, then the VSC row. */
export type ScCall = { carId: CarId; rows: [ScCallRow, ScCallRow] };
