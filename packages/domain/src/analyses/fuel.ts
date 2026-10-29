// Value type of the `fuel` analysis (spec 5.2, A.3).
import type { Known } from '../known.ts';
import type { Kg } from '../units.ts';

/** `fuel.car`: fuel now, burn, and the margin in laps against the laps left. */
export type FuelState = {
  kg: Known<Kg>;
  burnKgPerLap: Known<Kg>;
  /** `kg / burn`. */
  lapsOfFuel: Known<number>;
  lapsLeft: Known<number>;
  /** `lapsOfFuel − lapsLeft`; negative = short of fuel. */
  marginLaps: Known<number>;
  /** `burn − kg / lapsLeft`; `notApplicable` when `marginLaps >= 0`. */
  saveTargetKgPerLap: Known<Kg>;
  /** The game's MFD figure (`remainingLaps`); its meaning is unverified. */
  gameRemainingLaps: Known<number>;
  mix: Known<'lean' | 'standard' | 'rich' | 'max'>;
};
