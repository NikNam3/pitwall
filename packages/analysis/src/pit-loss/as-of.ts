// `pit-loss` as of frame N (SP4.3a spec 6.1, plan Task 15b): the calculator's output from the projection cut at N, the
// situation at N and the run's fixed inputs (`AsOfView`); the scheduled run is `pitLossAsOf(asOfNow(view))`.
import type { PitLosses } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';

/** The output of `pit-loss` as of the view's frame. */
export function pitLossAsOf(_view: AsOfView): PitLosses {
  throw new Error('not implemented');
}
