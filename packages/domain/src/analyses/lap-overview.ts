// Value type of the `lap-overview` analysis (spec 3.2, V09): every lap of a car as one block.
import type { VisualCompound } from '../compounds.ts';
import type { Known } from '../known.ts';
import type { Ms, Ratio } from '../units.ts';

/** The lap's track status: from its record's neutralised time (`lap-classes`) and its membership (C26). */
export type LapStatus = 'green' | 'vsc' | 'sc' | 'red';

/** One lap: `heat` 0 = the stint's fastest `forPace` lap, 1 = its slowest; `best` as of now. */
export type LapOverviewLap = {
  lapNumber: number;
  lapTimeMs: Ms;
  stint: number;
  compound: VisualCompound;
  kind: 'in' | 'out' | 'normal';
  best: 'session' | 'personal' | 'none';
  heat: Known<Ratio>;
  status: LapStatus;
};

/** `lapOverview.car`: the car's laps in lap order. */
export type LapOverview = { laps: LapOverviewLap[] };
