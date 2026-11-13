// Defaults of `undercut` (SP4.3b spec §9.1, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const UNDERCUT_CONFIG = defineConfig('undercut', {
  /** The rivals: the cars directly ahead and behind within this gap, then the next one each way within it (ms). Source: spec §9.1, §11.1 (`forecast-score`'s `closeGapMs`, research 12 §8). */
  undercutRangeMs: 3000,
  /** The cases per rival: the second stop 1 … this many laps after the first. Source: spec §9.1, §11.1 (N 1–3). */
  maxLapsLater: 3,
  /**
   * The cap on scenario-policies of one car's run (a count, never a clock, C2). Source: spec §9.1, §11.1 (2,400: up to
   * 4 rivals × 3 N × 2 policies, 100 common scenarios each), lowered to fit the budget of 300 ms per car (§11.2): at
   * 2,400 the long-race builder at lap 1 took 400–455 ms per car (DP solve and thresholds about 150 ms, scoring about
   * 0.1 ms per scenario-policy); 1,200 is 12 cases × 100 scenarios (SP4.3b2 Task 7).
   */
  maxScenarioPolicies: 1200,
});

/** `undercut`'s config values as the job reads them. */
export type UndercutConfig = typeof UNDERCUT_CONFIG.defaults;
