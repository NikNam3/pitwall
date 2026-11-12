// `track-wetness` (SP4.3a spec 5.1): a quick calculator (C31) that recomputes at every completed lap; its scheduled run
// is its "as of" form at the current frame (spec 6.1).
import { asOfNow, type QuickCalculator } from '@pitwall/engine/readers';
import { trackWetnessAsOf } from './asof.ts';
import { TRACK_WETNESS, type TrackWetnessOutput } from './index.ts';

export const trackWetnessCalculator: QuickCalculator<TrackWetnessOutput> = {
  id: TRACK_WETNESS,
  kind: 'quick',
  // `miniSectors`: the change tag of the crossings list (the brief's `crossings`)
  reads: ['laps', 'stints', 'miniSectors', 'session', 'spans:weekend-phase', 'spans:session-phase-race', { calculator: 'degradation' }],
  cadence: 'lapCompleted',
  compute: (view) => trackWetnessAsOf(asOfNow(view)),
};
