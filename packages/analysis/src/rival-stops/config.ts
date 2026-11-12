// Defaults of `rival-stops` (SP4.3a spec 5.3, 8; SP4.3b spec F3).
import { defineConfig } from '@pitwall/engine/readers';

export const RIVAL_STOPS_CONFIG = defineConfig('rival-stops', {
  /** Before any peer has stopped: the window is `tyre-life`'s predicted life ± this many laps. Source: pitwall estimate. */
  noPeerSpreadLaps: 4,
  /** An overdue car (its window's high lap before its next lap): the window's mid lap is its next lap plus this many laps. Source: pitwall estimate (SP4.3b F3). */
  overdueMidLaps: 2,
  /** An overdue car: the window's high lap is its next lap plus this many laps, capped by the flag. Source: pitwall estimate (SP4.3b F3). */
  overdueSpreadLaps: 5,
});
