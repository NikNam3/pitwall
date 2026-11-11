// Defaults of `race-interaction` (SP4.3a spec 5.4, 8). The pass curve's values are placeholders until the pooled fit
// (SP4.3a plan Task 13) sets them.
import { defineConfig } from '@pitwall/engine/readers';

export const RACE_INTERACTION_CONFIG = defineConfig('race-interaction', {
  /** The AI-difficulty bands, `from-to` inclusive, comma-separated; one pass curve each. Source: placeholder until the pooled fit (Task 13). */
  difficultyBands: '0-79,80-110',
  /** The pass curve's level. Source: placeholder until the pooled fit (Task 13). */
  passLevel: -2.0,
  /** The pass curve's slope per ms of pace advantage. Source: placeholder until the pooled fit (Task 13). */
  passSlopePerMs: 0.004,
  /** The pass curve's cap: the most likely a pass at one braking zone gets. Source: placeholder until the pooled fit (Task 13). */
  passCap: 0.6,
  /** The pass probability's factor when wet. Source: placeholder until the pooled fit (Task 13). */
  wetFactor: 0.7,
  /** The pass probability's factor with DRS (only where the car ahead is not itself in DRS range). Source: research 12 §4 (0.71 against 0.58 passes per lap of following, about ×1.2). */
  drsPassFactor: 1.2,
  /** The time DRS gains on a straight against the car directly ahead (ms). Source: assumed (spec 8). */
  drsStraightGainMs: 250,
  /** The minimum following gap: a follower is held at it (ms). Source: pitwall estimate. */
  minGapMs: 500,
  /** The time the car ahead loses per lap while a faster car is within `minGapMs` (ms). Source: TUM (0.3 s per lap), until the O14 check (Task 13). */
  heldLossMsPerLap: 300,
  /** The rejoin push-back (ms). Source: TUM 0.5 s, Aguad 0.4 s, until the O14 check (Task 13). */
  rejoinPushBackMs: 450,
  /** Dirty air's loss per lap (ms). Source: spec 5.4 (0 by default). */
  dirtyAirMsPerLap: 0,
  /** The prior's weight in episodes in the shrinkage towards this race's episodes. Source: pitwall estimate. */
  shrinkEpisodes: 20,
});
