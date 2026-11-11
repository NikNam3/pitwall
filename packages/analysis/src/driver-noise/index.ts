// `driver-noise` (SP4.3a spec 5.2): per car its lap scatter, lap-to-lap correlation, mistakes, big events,
// retirements and tyre wear rates, AI or human by the car's car-driver span. A calculator: no topic.
import type { DriverNoise } from '@pitwall/domain';

export * from './config.ts';
export { driverNoiseAsOf } from './asof.ts';

/** The calculator id. */
export const DRIVER_NOISE = 'driver-noise';

/** The output: every car's noise model and the AI field's rates. */
export type DriverNoiseOutput = DriverNoise;
