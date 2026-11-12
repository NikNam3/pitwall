// `race-interaction` (SP4.3a spec 5.4): a quick calculator (C31) that recomputes at line crossings; its scheduled run is
// its "as of" form at the current frame (spec 6.1).
import { asOfNow, type QuickCalculator } from '@pitwall/engine/readers';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { raceInteractionAsOf } from './asof.ts';
import { RACE_INTERACTION, type RaceInteractionOutput } from './index.ts';

export const raceInteractionCalculator: QuickCalculator<RaceInteractionOutput> = {
  id: RACE_INTERACTION,
  kind: 'quick',
  // `miniSectors`: the change tag of the crossings list (the brief's `crossings`)
  reads: ['miniSectors', 'laps', 'pitStops', 'session', 'decisions', 'spans:session-phase-race', 'spans:weekend-phase', CAR_STATUS_READS],
  cadence: 'lapCompleted',
  compute: (view) => raceInteractionAsOf(asOfNow(view)),
};
