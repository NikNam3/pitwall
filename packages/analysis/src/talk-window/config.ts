// Defaults of `talk-window` (spec 6.3).
import { defineConfig } from '@pitwall/engine/readers';

export const TALK_WINDOW_CONFIG = defineConfig('talk-window', {
  /** The car is busy this long before it reaches a braking zone, at its speed now. Source: pitwall estimate (A17). */
  leadS: 1.5,
});
