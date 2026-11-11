// `track-wetness` as of a frame (SP4.3a spec 5.1, 6.1): a pure function of the `AsOfView`.
import type { TrackWetness } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';

/** The field's common mode per lap and tyre type, and the filtered wetness state, as of `view`'s frame. */
export function trackWetnessAsOf(_view: AsOfView): TrackWetness {
  throw new Error('not implemented');
}
