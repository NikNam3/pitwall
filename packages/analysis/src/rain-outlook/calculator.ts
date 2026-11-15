// The `rain-outlook` calculator (spec 3.3; SP4.3c O3a): the samples ahead (`offsetMin ≥ 0`, in time order), the first
// of them with a rain chance of at least `rainPct`, and whether it lies within `horizonMin`. `index` is into the
// samples ahead. No such sample is `notApplicable` (C3).
import { known, unknown } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { RAIN_OUTLOOK, RAIN_OUTLOOK_CONFIG, samplesAheadOf, type RainOutlook } from './index.ts';

export const rainOutlookCalculator: QuickCalculator<RainOutlook> = {
  id: RAIN_OUTLOOK,
  kind: 'quick',
  reads: ['session'],
  cadence: 'frame',
  compute: (view) => {
    const { rainPct, horizonMin } = RAIN_OUTLOOK_CONFIG.read(view);
    const { forecast, updatedAt } = view.live.session;
    const samplesAhead = samplesAheadOf(forecast);
    const index = samplesAhead.findIndex((s) => s.rainPct >= rainPct);
    const first = samplesAhead[index];
    if (first === undefined) return { firstRain: unknown('notApplicable'), withinHorizon: false, samplesAhead };
    return {
      firstRain: known({ index, offsetMin: first.offsetMin, rainPct: first.rainPct }, updatedAt),
      withinHorizon: first.offsetMin <= horizonMin,
      samplesAhead,
    };
  },
};
