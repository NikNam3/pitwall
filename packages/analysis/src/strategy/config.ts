// Defaults of `strategy` (SP4.3b spec §8.1, §11.1), and of `race-monte-carlo`, which the job runs with them (spec
// §11.1: "race-monte-carlo (through strategy)"; a simulator has no config of its own, C50).
import { defineConfig } from '@pitwall/engine/readers';

export const STRATEGY_CONFIG = defineConfig('strategy', {
  /** A DP plan's stop-lap neighbours from this many laps away… Source: spec §8.1 (neighbour range 1–3 laps). */
  neighbourMinLaps: 1,
  /** …to this many laps away. Source: spec §8.1 (neighbour range 1–3 laps). */
  neighbourMaxLaps: 3,
  /** The most stops a candidate plan has. Source: spec §6, §11.1. */
  maxStops: 3,
  /** The most DP plans a car's candidates keep, the best by expected time (box-now and stay-out besides). Source: SP4.3b Task 23: 98–136 candidates left 8–15 scenarios each at the cap; 8 keeps ~50–60. */
  dpPlansMax: 8,
  /** Inter and wet plans are candidates once the forecast's highest rain chance over the remaining laps reaches this (%), or the track's wetness the DP's rain threshold. Source: research 19 wetness: the game shows light rain from about 25 % rain chance. */
  rainCandidatePct: 25,
  /** The rule candidates' gap: the cover rule's car within this of ours (ms). Source: `forecast-score`'s `closeGapMs`, research 12 §8. */
  ruleGapMs: 3000,
  /**
   * The DP's traffic term (spec §6): a rejoin within this of a car ahead (on the plain forecast's road at that lap's
   * line) costs the shortfall. Source: spec §11.1 (`pit-sweep`'s `trafficGapMs`); a pitwall estimate, approximate
   * (research 13 §10): the neighbours and the Monte Carlo choose (spec §6).
   */
  trafficGapMs: 1000,
  // race-monte-carlo (spec §7.3, §11.1)
  /** Scenarios of the first batch, for every candidate (common random numbers). Source: spec §7.3 (30–50). */
  n0: 40,
  /** A policy is dropped when worse than the leader by this many SEs of the paired difference. Source: spec §7.3. */
  zDrop: 2.8,
  /** A policy ties with the leader below this many SEs of the paired difference… Source: spec §7.3 (research 14 proposal 1). */
  zTie: 2,
  /** …or below this many places of E[position]. Source: spec §7.3 (research 14 proposal 1). */
  tieBand: 0.05,
  /** The shown top few scored again together on fresh common scenarios. Source: spec §7.3. */
  rescoreTop: 5,
  /**
   * The cap on scenario-policies of one run, both our cars, re-scoring included (a count, never a clock, C2). Source:
   * SP4.3b Task 19's measurement: 0.64 ms per scenario-policy (long-race builder, lap 1, single thread, best of 6 warm
   * passes); Task 20's job budget measured 4.28 s at 6,000 (5.04 s under load), so 5,500 (~3.9 s) keeps a margin inside
   * the 5 s cap (S26); above research 14's ~4,600 that good selection needs.
   */
  maxScenarioPolicies: 5500,
  /**
   * Round 1's share of `maxScenarioPolicies`, split over the cars planned; the final rankings share the rest (0: no round
   * 1). Source: SP4.3b Task 20d: round 1 only finds the other car's best; most of the cap to the final ranking.
   */
  round1Share: 0.2,
  /** The league points table, position 1 first, comma-separated. Source: F1 sporting regulations (25-18-15-12-10-8-6-4-2-1). */
  points: '25,18,15,12,10,8,6,4,2,1',
  /** Under an SC, a rival with a stop still ahead (its rival-stops window; not only one the compound rule demands) boxes with this chance. Source: spike 4.3b-defaults (research 19 §5): 28 of 32 AI cars with a stop still ahead boxed under 3 SCs (Zandvoort, Texas, Spa), SE 0.05; thin */
  rivalScBoxChance: 0.88,
  /** … once its tyres are at least this many laps old (`aMin`). Source: spike 4.3b-defaults (research 19 §5): the youngest AI car with a stop ahead that boxed under an SC (3 SCs); no younger such car seen; thin */
  rivalScMinTyreAge: 4,
  /** In the wet a rival switches tyre type this many laps after its type falls behind (`reactionLaps`). Source: spike 4.3b-defaults (research 19 §5): the AI switched within one lap of the crossover or before it at 3 crossovers (54 switches, Singapore and Mexico); thin */
  rivalReactionLaps: 0,
});

/** `strategy`'s config values as the job reads them. */
export type StrategyConfig = typeof STRATEGY_CONFIG.defaults;
