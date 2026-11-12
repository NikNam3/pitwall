// Free-air laps (SP4.3a spec 5.1, 5.2; C43): the laps no car ran within a gap ahead of. One function, so
// `track-wetness` and `driver-noise` judge free air alike.
import type { Ms } from '@pitwall/domain';
import type { Projection } from '@pitwall/engine/readers';

/** The laps (`carId:lap`) at none of whose crossings another car was within `gapMs` ahead. */
export function freeAirLaps(_history: Projection, _gapMs: Ms): ReadonlySet<string /* carId:lap */> {
  throw new Error('not implemented');
}
