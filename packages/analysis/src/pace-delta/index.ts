// `pace-delta` (spec 4): time lost per lap after an event. A function, imported by the analyses that use it.
import type { Known, Ms, SessionTime } from '@pitwall/domain';

/**
 * Mean of the pace laps after an event minus the mean of those before it (positive = slower after); at least two on
 * each side, otherwise `unknown('insufficientData')`.
 */
/** Time lost per lap after an event (positive = slower after); a known result carries `at`, the session time it is valid for. */
export function paceDelta(_beforeMs: Ms[], _afterMs: Ms[], _at: SessionTime): Known<Ms> {
  throw new Error('not implemented');
}
