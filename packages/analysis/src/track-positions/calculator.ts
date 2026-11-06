// `track-positions` (spec 6.1): every competing car on the track map and the map's geometry. A stub of the test phase
// (C82): the implement phase writes `compute`.
import type { EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { TRACK_POSITIONS, type TrackPositionsOutput } from './index.ts';

/** The track map's geometry and cars, from the view's track file, live timing and the open spans (C20). */
export const trackPositionsCalculator: QuickCalculator<TrackPositionsOutput> = {
  id: TRACK_POSITIONS,
  kind: 'quick',
  reads: ['session', 'timing', 'identity', 'spans:car-status', 'spans:car-location', 'spans:car-flags', 'spans:zone-flags'],
  cadence: 'frame',
  compute(view: EngineView): TrackPositionsOutput {
    void view;
    throw new Error('not implemented');
  },
};
