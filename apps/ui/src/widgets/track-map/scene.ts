// The track map's scene (spec 7.2): a pure mapping from the topic values to what the kit's track canvas draws.
// Test-phase stub: the implement phase writes it.
import type { Known, MapIncident, TrackCars, TrackGeometry } from '@pitwall/domain';
import type { TrackScene } from '../../kit/track/types.ts';
import type { WidgetSize } from '../../kit/types.ts';

/** The scene of the geometry, the cars and the markers at the panel's size. */
export function sceneOf(
  _geometry: TrackGeometry,
  _cars: Known<TrackCars>,
  _markers: Known<MapIncident[]> | undefined,
  _size: Pick<WidgetSize, 'mode'>,
): TrackScene {
  throw new Error('not implemented');
}
