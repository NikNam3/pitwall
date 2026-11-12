// Defaults of `rival-stops` (SP4.3a spec 5.3, 8).
import { defineConfig } from '@pitwall/engine/readers';

export const RIVAL_STOPS_CONFIG = defineConfig('rival-stops', {
  /** Before any peer has stopped: the window is `tyre-life`'s predicted life ± this many laps. Source: pitwall estimate. */
  noPeerSpreadLaps: 4,
});
