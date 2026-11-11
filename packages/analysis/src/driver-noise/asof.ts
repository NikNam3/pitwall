// `driver-noise` as of a frame (SP4.3a spec 5.2, 6.1): a pure function of the `AsOfView`.
import type { DriverNoise } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';

/** Every car's noise model and the AI field's rates, as of `view`'s frame. */
export function driverNoiseAsOf(_view: AsOfView): DriverNoise {
  throw new Error('not implemented');
}
