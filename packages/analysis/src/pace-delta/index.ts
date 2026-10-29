// `pace-delta` (spec 4): time lost per lap after an event. A function, imported by the analyses that use it.
import type { Known, Ms } from '@pitwall/domain';

/**
 * Mean of the pace laps after an event minus the mean of those before it (positive = slower after); at least two on
 * each side, otherwise `unknown('insufficientData')`.
 */
export function paceDelta(_beforeMs: Ms[], _afterMs: Ms[]): Known<Ms> {
  throw new Error('not implemented');
}
