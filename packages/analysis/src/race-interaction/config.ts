// Defaults of `race-interaction` (SP4.3a spec 5.4, 8). The pass curve's values come from the pooled fit (SP4.3a plan
// Task 13, docs/research/15-pass-curve-fit.md; refit in SP4.3b Task 13, docs/research/19-strategy-defaults.md).
import { defineConfig } from '@pitwall/engine/readers';

export const RACE_INTERACTION_CONFIG = defineConfig('race-interaction', {
  /** The AI-difficulty bands, `from-to` inclusive, comma-separated; one pass curve each. Source: kept for later fits; the pooled fit gives both one curve (research 15, ruling R39). */
  difficultyBands: '0-79,80-110',
  /** The pass curve's level (Source: pooled fit over 5 F1 25 races (Mexico, Miami, Texas, China, Spa; AI difficulty 62–90; 484 following episodes, 1,661 braking zones, 118 passes; 149 DRS episodes, 212 DRS zones, 40 DRS passes), research 19 (SP4.3b Task 13: leave-one-race-out log-loss 0.2500 vs 0.2556 with Singapore and Zandvoort admitted); the bands share one curve; Fisher SE 0.19, race-bootstrap SE 0.40). */
  passLevel: -2.629,
  /** The pass curve's slope per ms of pace advantage (Source: pooled fit over 5 F1 25 races (Mexico, Miami, Texas, China, Spa; AI difficulty 62–90; 484 following episodes, 1,661 braking zones, 118 passes; 149 DRS episodes, 212 DRS zones, 40 DRS passes), research 19 (SP4.3b Task 13: leave-one-race-out log-loss 0.2500 vs 0.2556 with Singapore and Zandvoort admitted); the bands share one curve; Fisher SE 0.00026, bootstrap SE 0.00040). */
  passSlopePerMs: 0.001044,
  /** The pass curve's cap: the most likely a pass at one braking zone gets. Source: assumed: the pooled fit cannot identify it (flat likelihood from 0.2 to 1.0, research 15). */
  passCap: 0.6,
  /** The pass probability's factor when wet. Source: research 19 pooled fit, Mexico and Miami, 622 wet zones, 33 passes (Fisher SE 0.09, bootstrap SE 0.24, thin: both races wet throughout, mixed with the tracks). */
  wetFactor: 0.46,
  /**
   * The prior of the pass curve's DRS factor: the log-odds shift of a pass at a braking zone after a DRS zone (only where
   * the car ahead is not itself in DRS range); this race's episodes refine it with `shrinkEpisodes` (SP4.3b Task 10).
   * Source: pooled fit over 5 F1 25 races (Mexico, Miami, Texas, China, Spa; AI difficulty 62–90; 484 following episodes, 1,661 braking zones, 118 passes; 149 DRS episodes, 212 DRS zones, 40 DRS passes), research 19 (SP4.3b Task 13: leave-one-race-out log-loss 0.2500 vs 0.2556 with Singapore and Zandvoort admitted); the bands share one curve (about ×6.8 on the odds; Fisher SE 0.30, bootstrap SE 0.37).
   */
  drsPassFactor: 1.917,
  /** The time DRS gains on a straight against the car directly ahead (ms). Source: assumed (spec 8). */
  drsStraightGainMs: 250,
  /** The minimum following gap: a follower is held at it (ms). Source: pitwall estimate. */
  minGapMs: 500,
  /** The time the car ahead loses per lap while a faster car is within `minGapMs` (ms). Source: O14 check, research 15: about 0 measured (+120 ms, SE 324, 19 held-lap equivalents; thin); TUM's 0.3 s not supported. */
  heldLossMsPerLap: 0,
  /** The rejoin push-back (ms). Source: O14 check, research 15: no push-back seen (5 rejoins within 1 s, 2 races; thin); TUM 0.5 s and Aguad 0.4 s not supported. */
  rejoinPushBackMs: 0,
  /** Dirty air's loss per lap (ms). Source: spec 5.4 (0 by default). */
  dirtyAirMsPerLap: 0,
  /** The prior's weight in episodes in the shrinkage towards this race's episodes. Source: pitwall estimate. */
  shrinkEpisodes: 20,
  /**
   * A follower within `minGapMs` plus this at a braking zone is held there (ms): a held car's time gap is the minimum gap
   * times its speed over the leader's (about 3 %, 15 ms, at 2.8 s a lap of advantage), plus the interpolated crossings'
   * slack; a wider margin counts cars still closing in, which pass nobody yet. Source: pitwall estimate (generator races).
   */
  heldSlackMs: 20,
  /** A car within this gap of the car ahead at a DRS detection point has DRS in the zone (ms). Source: the game's DRS rule (1 s). */
  drsRangeMs: 1000,
  /** The first lap DRS is enabled in a race. Source: the sporting regulations (DRS from lap 3). */
  drsFromLap: 3,
  /** A lap ending with this much damage or more on a wing (front left, front right, rear) is left out (%). Source: spec 5.5. */
  aeroDamageMaxPct: 10,
  /** A race stint the calibration suggests as a source has at least this many following episodes of its car. Source: SP4.3a plan Task 12. */
  candidateEpisodes: 3,
});

/** The effective `race-interaction` config: what `followingEpisodes`, `excludedLap` and the priors read (C43, C47). */
export type RaceInteractionConfig = typeof RACE_INTERACTION_CONFIG.defaults;
