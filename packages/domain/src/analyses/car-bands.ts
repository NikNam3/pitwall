// Value types of the `car-bands` analysis (spec 5.4, A.3). No hysteresis and no "out since": calculators keep no frame state (ruling R1).
import type { Corners } from '../corners.ts';
import type { Known } from '../known.ts';

/** Where a value is against its band, live. */
export type BandState = 'below' | 'in' | 'above';

/** One channel against its band. */
export type BandReading = {
  value: Known<number>;
  /**
   * The live value against the band; the tyre surface and the brakes have none (`unknown('notApplicable')`): the surface
   * swings 30–60 °C within a lap and the brakes fall below the band on many straights, so only `outForFullLap` judges them.
   */
  state: Known<BandState>;
  /** The band in the channel's unit (°C or psi); tyre bands are per compound. */
  band: { lo: number; hi: number };
  /** The last completed lap's whole range (min and max) was outside the band. */
  outForFullLap: boolean;
};

/** `carBands.car`: every band channel of the car. */
export type CarBands = {
  tyres: Corners<{ surfaceC: BandReading; carcassC: BandReading; pressurePsi: BandReading }>;
  brakesC: Corners<BandReading>;
  engineC: BandReading;
};
