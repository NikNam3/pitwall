// Defaults of `lap-classes` (spec 4); the analyses that call `classifyLap` read them and pass them as `opts`.
import { defineConfig } from '@pitwall/engine/readers';

export const LAP_CLASSES_CONFIG = defineConfig('lap-classes', {
  /**
   * Neutralised time (SC plus VSC) a pace or rate lap stays below, in ms: the game's flag lags the restart by up to about
   * a second, so a green lap can carry a sliver of SC. Source: user ruling 2026-10-30 (the game's flag lag at restarts).
   */
  maxNeutralisedMs: 2000,
});
