// Defaults of `strategy-dp` (SP4.3c spec §5.4a, O3b; C47): read by the shared strategy input that builds its input,
// fixed for a run.
import { defineConfig } from '@pitwall/engine/readers';

export const STRATEGY_DP_CONFIG = defineConfig('strategy-dp', {
  /** The weather worlds the DP solves (`weather-paths`' `weatherWorlds(start, worlds)`), one solve each. Source: SP4.3c spec §5.4a (K = 2). */
  worlds: 2,
});
