// `pace-delta` (spec 4): time lost per lap after an event. A function, imported by the analyses that use it.
import { known, unknown, type Known, type Ms, type SessionTime } from '@pitwall/domain';

const MIN_LAPS = 2;

const mean = (values: Ms[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Time lost per lap after an event (positive = slower after): the mean of the pace laps after it minus the mean of
 * those before it. At least two laps on each side, otherwise `unknown('insufficientData')`. A known result carries
 * `at`, the session time it is valid for.
 */
export function paceDelta(beforeMs: Ms[], afterMs: Ms[], at: SessionTime): Known<Ms> {
  if (beforeMs.length < MIN_LAPS || afterMs.length < MIN_LAPS) return unknown('insufficientData');
  return known(mean(afterMs) - mean(beforeMs), at);
}
