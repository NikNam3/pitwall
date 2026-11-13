// Defaults of `undercut` (SP4.3b spec §9.1, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const UNDERCUT_CONFIG = defineConfig('undercut', {
  /** The rivals: the cars directly ahead and behind within this gap, then the next one each way within it (ms). Source: spec §9.1, §11.1 (`forecast-score`'s `closeGapMs`, research 12 §8). */
  undercutRangeMs: 3000,
  /** The cases per rival: the second stop 1 … this many laps after the first. Source: spec §9.1, §11.1 (N 1–3). */
  maxLapsLater: 3,
  /**
   * The cap on scenario-policies of one car's run (a count, never a clock, C2). Source: spec §9.1, §11.1; budget 2.5 s
   * per car (§11.2; user Q9 2026-11-13: up to 5 s per call on its own thread, both our cars in one run): measured on an
   * idle machine 2026-11-13 at lap 1 of the long-race builder, 2,322 ms per car at 20,000 (DP about 150 ms, scoring about
   * 0.11 ms per scenario-policy), so 16,000 (about 1.9 s; 12 cases × 1,333 scenarios).
   */
  maxScenarioPolicies: 16000,
});

/** `undercut`'s config values as the job reads them. */
export type UndercutConfig = typeof UNDERCUT_CONFIG.defaults;
