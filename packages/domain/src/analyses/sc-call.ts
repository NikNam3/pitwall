// Value types of the `sc-call` analysis (SP4.3b spec §9.3; from SP4.2 spec 3.3): per condition SC and VSC, boxing under
// it now against staying out, the neutralisation forced at the current lap (or the real one while one is out).
import type { EstimateSource } from '../estimates.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/**
 * One condition's row: the E[position] difference of boxing against staying out (places, positive = good), the chance
 * boxing finishes ahead, the places-gained distribution (`SC_CALL_GAIN_BINS`), our rejoin position, the stop's loss with
 * its source, and the DP's trigger range of that condition for the next stop.
 */
export type ScCallRow = {
  condition: 'sc' | 'vsc';
  ePosDelta: Known<number>;
  pGain: Known<number>;
  /** 9 shares, places gained −4 … +4; the ends hold the tails. */
  gainBins: Known<number[]>;
  rejoinPosition: Known<number>;
  lossMs: Known<Ms>;
  lossSource: EstimateSource;
  /** The DP's trigger range for the next stop. */
  range: Known<{ fromLap: number; toLap: number }>;
};

/** `scCall.car`: the SC row, then the VSC row; a row that does not apply has every `Known` `unknown(reason)`. */
export type ScCall = { carId: CarId; lap: number; rows: [ScCallRow, ScCallRow] };

/** The places-gained bins of `ScCallRow.gainBins`: one bin per whole place, −4 … +4. */
export const SC_CALL_GAIN_BINS = { from: -4.5, step: 1, count: 9 } as const;
