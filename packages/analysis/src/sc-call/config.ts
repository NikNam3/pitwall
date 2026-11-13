// Defaults of `sc-call` (SP4.3b spec §9.3, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const SC_CALL_CONFIG = defineConfig('sc-call', {
  /** The cap on scenario-policies of one car's run (a count, never a clock, C2). Source: spec §9.3, §11.1 (SC and VSC × box and stay out, to the flag; budget 2.5 s per car, §11.2, user Q9 2026-11-13: up to 5 s per call on its own thread; measured 2026-11-13 on an idle machine: 1,720 ms per car at 1,300, so 1,400, about 1.85 s). */
  maxScenarioPolicies: 1400,
});

/** `sc-call`'s config values as the job reads them. */
export type ScCallConfig = typeof SC_CALL_CONFIG.defaults;
