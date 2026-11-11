// `rival-stops` as of a frame (SP4.3a spec 5.3, 6.1): a pure function of the `AsOfView`.
import type { RivalStops } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';

/** Per rival the next stop's window, the next compound's odds and whether it owes a stop, as of `view`'s frame. */
export function rivalStopsAsOf(_view: AsOfView): RivalStops {
  throw new Error('not implemented');
}
