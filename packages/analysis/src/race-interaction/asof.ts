// `race-interaction` as of a frame (SP4.3a spec 5.4, 6.1): a pure function of the `AsOfView`.
import type { RaceInteraction } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';

/** The pass curves, DRS, the following gap and the O14 values, as of `view`'s frame. */
export function raceInteractionAsOf(_view: AsOfView): RaceInteraction {
  throw new Error('not implemented');
}
