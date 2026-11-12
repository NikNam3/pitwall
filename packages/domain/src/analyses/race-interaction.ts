// Value type of the `race-interaction` calculator (SP4.3a spec 5.4): the pass curve per difficulty band, DRS, the following gap and the O14 values.
import type { EstimateSource } from '../estimates.ts';
import type { Known } from '../known.ts';

/** p(pass at one braking zone) = cap · 1 / (1 + exp(−(level + slopePerMs · advantageMs))), × wetFactor when wet. */
/** `drsFactor`: the log-odds shift of a pass in a braking zone after a DRS zone (SP4.3b Task 10). */
export type PassCurve = { level: number; slopePerMs: number; cap: number; wetFactor: number; drsFactor: number };

export type RaceInteraction = {
  bands: { fromDifficulty: number; toDifficulty: number; curve: PassCurve; source: EstimateSource; episodes: number; passes: number }[];
  /** This session's band index (aiDifficulty). */
  band: Known<number>;
  drsPassFactor: number;
  drsStraightGainMs: number;
  minGapMs: number;
  heldLossMsPerLap: Known<number>;
  rejoinPushBackMs: Known<number>;
  dirtyAirMsPerLap: number;
};
