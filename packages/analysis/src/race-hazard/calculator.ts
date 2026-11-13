// `race-hazard` (SP4.3b spec §5.2): the scheduled run of its as-of form (`asof.ts`) at the current frame. A quick
// calculator (C31) on change only (C41): a new leader lap, a race session-phase span opened, closed or given a stage,
// or a change of the session's game settings (the lobby's SC setting).
import type { RaceHazard } from '@pitwall/domain';
import { asOfNow, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { raceHazardAsOf } from './asof.ts';
import { RACE_HAZARD } from './id.ts';

export const raceHazardCalculator: QuickCalculator<RaceHazard> = {
  id: RACE_HAZARD,
  kind: 'quick',
  // `session`: totalLaps and the lobby setting; `laps`: the leader's laps; `view.track` is fixed for the run (C62b)
  reads: ['session', 'spans:session-phase-race', 'spans:weekend-phase', 'laps'],
  cadence: { onChange: ['leaderLap', 'spans:session-phase-race', 'sessionSettings'] },
  compute: (view: EngineView): RaceHazard => raceHazardAsOf(asOfNow(view)),
};
