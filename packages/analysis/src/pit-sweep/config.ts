// Defaults of `pit-sweep` (SP4.3b spec §9.2, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const PIT_SWEEP_CONFIG = defineConfig('pit-sweep', {
  /** Traffic: a car within this gap of ours at a line crossing (ms). Source: spec §9.2, §11.1 (the DRS line that decides an undercut, Aguad fn. 15). */
  trafficGapMs: 1000,
  /** Traffic: counted over this many laps after the stop. Source: spec §9.2, §11.1 (where traffic losses are settled, research 13 §10.2, Tulabandhula & Rudin). */
  trafficLaps: 3,
  /** A compound's rows start this many stop laps before its window opens (`pit-window`'s `windowLaps.from`), never before now. Source: SP4.3b2 Task 18q, Q10 B (the approved mockup `pit-sweep-table.html`: rows from L14 around a window of L19–L21). */
  rowsBefore: 3,
  /** A compound's rows end this many stop laps after its window closes (`windowLaps.to`, the stint's latest stop lap), never past the last lap − 1; the mockup's four rows past the set's life (Task 2b's `pastLifeLaps` 4) lie inside. Source: SP4.3b2 Task 18q, Q10 B (the mockup's rows to L26 past a window of L19–L21 with life to L22). */
  rowsAfter: 8,
  /** The cap on scenario-policies per (car, compound) part, shared by its rows (a count, never a clock, C2). Source: SP4.3b2 Task 18q, Q10 A (≈ 500 races per row at 17 rows; one part per thread under 10 s, spec §9.2, §11.2); a placeholder until the supervisor's idle measurement. */
  maxScenarioPolicies: 8500,
});

/** `pit-sweep`'s config values as the job reads them. */
export type PitSweepConfig = typeof PIT_SWEEP_CONFIG.defaults;
