// `pit-loss` (spec 4.3, 4.4): the scheduled run of its as-of form (`as-of.ts`, spec 6.1) at the current frame. A quick
// calculator (C31): no accumulator holds priors.
import { asOfNow, type QuickCalculator } from '@pitwall/engine/readers';
import { pitLossAsOf } from './as-of.ts';
import { PIT_LOSS, type PitLossOutput } from './index.ts';

export const pitLossCalculator: QuickCalculator<PitLossOutput> = {
  id: PIT_LOSS,
  kind: 'quick',
  // `drivers`: `asOfNow` copies `view.drivers` into the as-of view; the form itself reads no profile
  reads: ['pitStops', 'laps', 'decisions', 'spans:weekend-phase', 'drivers'],
  cadence: 'frame',
  compute: (view): PitLossOutput => pitLossAsOf(asOfNow(view)),
};
