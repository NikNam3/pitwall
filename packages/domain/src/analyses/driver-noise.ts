// Value type of the `driver-noise` calculator (SP4.3a spec 5.2): per car its lap scatter, correlation, mistakes, big events, retirements and wear rates.
import type { EstimateSource } from '../estimates.ts';
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';

/** The compounds the noise and forecast models tell apart (the visual compounds). */
export type NoiseCompound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';

/** One car's noise model. */
export type CarNoise = {
  /** The car-driver span open at the view's frame. */
  driver: 'ai' | 'human' | 'unknown';
  sigmaMs: Known<number>;
  rho: Known<number>;
  mistakeRatePerLap: Known<number>;
  mistakeSize: Known<{ medianMs: number; sigmaLog: number }>;
  /** A green lap more than `bigEventMs` slow, the car running on. */
  bigEventRatePerLap: Known<number>;
  /** A retirement (plan review P5: apart from big slow laps). */
  retireRatePerLap: Known<number>;
  /** The worst corner's rate. */
  wearRatePctPerLap: Record<NoiseCompound, Known<number>>;
  /** Where each compound's wear rate comes from (spec 5.2: own laps, profile, our car's rate, default). */
  wearRateSource: Record<NoiseCompound, EstimateSource>;
  source: EstimateSource;
  laps: number;
};

/** `driver-noise`'s output: every car's model and the AI field's rates. */
export type DriverNoise = {
  cars: Record<CarId, CarNoise>;
  aiField: { mistakeRatePerLap: Known<number>; bigEventRatePerLap: Known<number>; retireRatePerLap: Known<number> };
};
