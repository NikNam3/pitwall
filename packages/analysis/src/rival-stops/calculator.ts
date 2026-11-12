// `rival-stops` (SP4.3a spec 5.3): per rival the next stop's window, the next compound's odds and whether it owes a
// stop. Quick (C31); its scheduled run is its "as of" form at the current frame (spec 6.1).
import { asOfNow, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { rivalStopsAsOf } from './asof.ts';
import { RIVAL_STOPS, type RivalStopsOutput } from './index.ts';

export const rivalStopsCalculator: QuickCalculator<RivalStopsOutput> = {
  id: RIVAL_STOPS,
  kind: 'quick',
  reads: ['stints', 'pitStops', 'laps', 'spans:compound-rule', 'spans:car-driver', CAR_STATUS_READS, 'spans:weekend-phase', { calculator: 'tyre-life' }],
  cadence: 'lapCompleted',
  compute: (view: EngineView): RivalStopsOutput => rivalStopsAsOf(asOfNow(view)),
};
