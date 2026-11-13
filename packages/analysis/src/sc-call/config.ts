// Defaults of `sc-call` (SP4.3b spec §9.3, §11.1).
import { defineConfig } from '@pitwall/engine/readers';

export const SC_CALL_CONFIG = defineConfig('sc-call', {
  /** The cap on scenario-policies of one car's run (a count, never a clock, C2). Source: spec §9.3, §11.1 (SC and VSC × box and stay out, 80 common scenarios each, to the flag; budget 500 ms per car, §11.2). */
  maxScenarioPolicies: 320,
});

/** `sc-call`'s config values as the job reads them. */
export type ScCallConfig = typeof SC_CALL_CONFIG.defaults;
