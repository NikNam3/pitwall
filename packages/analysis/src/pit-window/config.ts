// Defaults of `pit-window` (SP4.2 spec 3.4, 7).
import { defineConfig } from '@pitwall/engine/readers';

export const PIT_WINDOW_CONFIG = defineConfig('pit-window', {
  /** Laps before the window opens from which the `window` moment holds. Source: research 06 §4. */
  windowLeadLaps: 2,
});
