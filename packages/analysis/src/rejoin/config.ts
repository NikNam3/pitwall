// Defaults of `rejoin` (SP4.2 spec 3.2, 7).
import { defineConfig } from '@pitwall/engine/readers';

export const REJOIN_CONFIG = defineConfig('rejoin', {
  /** Laps of ghost lines on the gap chart. Source: mockups Q6 (2026-10-30). */
  ghostLaps: 6,
  /** Cars either side of the ghost in the crossing order. Source: mockups (crossing order full). */
  orderAround: 3,
});
