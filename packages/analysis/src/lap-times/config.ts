// Defaults of `lap-times` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const LAP_TIMES_CONFIG = defineConfig('lap-times', {
  /** Cars knocked out in Q1. Source: F1 qualifying format with 20 cars (FIA Sporting Regulations). */
  eliminatedQ1: 5,
  /** Cars knocked out in Q2. Source: F1 qualifying format with 20 cars (FIA Sporting Regulations). */
  eliminatedQ2: 5,
});
