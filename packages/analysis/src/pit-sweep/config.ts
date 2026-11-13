// Defaults of `pit-sweep` (SP4.3b spec §9.2, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const PIT_SWEEP_CONFIG = defineConfig('pit-sweep', {
  /** Traffic: a car within this gap of ours at a line crossing (ms). Source: spec §9.2, §11.1 (the DRS line that decides an undercut, Aguad fn. 15). */
  trafficGapMs: 1000,
  /** Traffic: counted over this many laps after the stop. Source: spec §9.2, §11.1 (where traffic losses are settled, research 13 §10.2, Tulabandhula & Rudin). */
  trafficLaps: 3,
  /** The rows run this many stop laps past the stint's latest stop lap (`pit-window`'s `stint.latest`). Source: SP4.3b2 plan Task 2b (the approved mockup `pit-sweep-table.html`: rows L23–L26 after the life ends at L22). */
  pastLifeLaps: 4,
  /** The cap on scenario-policies per car and compound (a count, never a clock, C2). Source: spec §9.2, §11.1 (to the flag, about 1.5 ms per scenario at lap 1; budget 1.5 s per car and compound, §11.2). */
  maxScenarioPolicies: 1000,
});

/** `pit-sweep`'s config values as the job reads them. */
export type PitSweepConfig = typeof PIT_SWEEP_CONFIG.defaults;
