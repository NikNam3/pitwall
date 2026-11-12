// Value type of the `rival-stops` calculator (SP4.3a spec 5.3): per rival the next stop's window, the next compound's odds and whether it owes a stop.
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { NoiseCompound } from './driver-noise.ts';

export type RivalStop = {
  /** From compound-rule's `required` span. */
  owesStop: Known<boolean>;
  window: Known<{ lowLap: number; midLap: number; highLap: number; toFlag: boolean }>;
  /** Odds, sum 1. */
  nextCompound: Known<Partial<Record<NoiseCompound, number>>>;
  basis: 'peers' | 'tyreLife' | 'noStop';
};

export type RivalStops = Record<CarId, RivalStop>;
