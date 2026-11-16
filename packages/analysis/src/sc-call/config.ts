// Defaults of `sc-call` (SP4.3d spec §6.3; from SP4.3b spec §9.3, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const SC_CALL_CONFIG = defineConfig('sc-call', {
  /** The cap on scenario-policies of one car's run (a count, never a clock, C2), split evenly over its blocks and, within a block, over its candidates. Source: SP4.3d spec §6.3 (3 conditions × up to 6 answers, to the flag; budget ≤ 5 s per car part on its own thread, user Q9 2026-11-13); SP4.3d1 Task 6, measured 2026-11-16 by `sc-call.budget.test.ts` alone (long race, lap 1, one DP solve, load ≈ 2): 2,450–3,000 ms per car part at 1,400, 4,300–4,850 ms at 1,800, so 1,400, a margin below 5 s for a loaded machine. */
  maxScenarioPolicies: 1400,
});

/** `sc-call`'s config values as the job reads them. */
export type ScCallConfig = typeof SC_CALL_CONFIG.defaults;
